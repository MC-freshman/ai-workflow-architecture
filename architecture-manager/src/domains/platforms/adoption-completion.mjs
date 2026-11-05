import { existsSync, readFileSync } from 'node:fs';
import { targetPath } from '../../core/paths.mjs';
import { parseJson as parseJsonText } from '../../core/json.mjs';

// Owner ruling 2026-10-28: 完全接入 = 能够流畅跑通架构管理（入驻）的所有步骤。
//
// This module is the single authoritative answer to "is this platform fully
// adopted". Before it existed the same field name `architectureComplete` was
// computed five different ways in five modules, so the same journal could be
// reported as complete by one caller and incomplete by another (D-167, D-168,
// D-169). Modules must ask here instead of spelling the flag themselves.
//
// The step sequence is the one `applyAutomaticOnboarding` actually walks.
export const ONBOARDING_STEP_SEQUENCE = ['configuration', 'backend', 'environment', 'providers', 'client', 'capabilities', 'l1-dual-cell', 'native', 'certification', 'governance', 'git'];

// Owner ruling 2026-10-13: a native step recorded as auxiliary is reported
// honestly and never gates completion. Any other non-passed status means the
// step did not run through, so it gates.
export const COMPLETION_TOLERATED_STEP_STATUSES = ['passed', 'auxiliary'];

const RULE = 'owner ruling 2026-10-28: full adoption = every onboarding step runs through; auxiliary native is recorded honestly and never gates (2026-10-13)';

function journalPath(workspaceRoot, platformId) {
  return targetPath(workspaceRoot, `${platformId}/runtime/maintenance/manager-onboarding/automatic.json`);
}

function unfinished(platformId, journalStatus, reason, extra = {}) {
  return {
    schema: 'architecture-manager-adoption-completion/v1',
    platformId,
    journalStatus,
    pipelineEra: 'none',
    complete: false,
    missingSteps: [...ONBOARDING_STEP_SEQUENCE],
    blockedSteps: [],
    pendingSteps: [],
    pendingSoftware: 0,
    reason,
    rule: RULE,
    ...extra
  };
}

export function readAdoptionCompletion({ workspaceRoot, platformId }) {
  const path = journalPath(workspaceRoot, platformId);
  if (!existsSync(path)) return unfinished(platformId, null, 'no onboarding journal');
  let journal;
  try { journal = parseJsonText(readFileSync(path, 'utf8')); } catch { return unfinished(platformId, null, 'unreadable onboarding journal'); }
  const steps = journal.steps || [];
  const latest = (name) => [...steps].reverse().find((item) => item.step === name) || null;
  const missingSteps = ONBOARDING_STEP_SEQUENCE.filter((name) => !steps.some((item) => item.step === name));
  const blockedSteps = ONBOARDING_STEP_SEQUENCE
    .map((name) => latest(name))
    .filter((row) => row && !COMPLETION_TOLERATED_STEP_STATUSES.includes(row.status))
    .map((row) => ({ step: row.step, status: row.status, reason: row.reason || null }));
  const pendingSteps = (journal.pending || []).map((row) => ({ step: row.step, reason: row.reason || null }));
  const pendingSoftware = (journal.pendingSoftware || []).length;
  const journalStatus = journal.status || null;
  const complete = journalStatus === 'complete' && !missingSteps.length && !blockedSteps.length;
  return {
    schema: 'architecture-manager-adoption-completion/v1',
    platformId,
    journalStatus,
    pipelineEra: steps.some((item) => item.step === 'l1-dual-cell') ? 'current-criteria' : 'pre-criteria',
    complete,
    missingSteps,
    blockedSteps,
    pendingSteps,
    pendingSoftware,
    reason: complete ? null : journalStatus !== 'complete' ? `journal status is ${journalStatus}` : missingSteps.length ? `${missingSteps.length} onboarding step(s) never ran` : 'a step did not run through',
    rule: RULE,
    writePerformed: false
  };
}
