// Entry-skill renderer for the onboarding wizard (NP1, owner requirement:
// wf/wfa usable immediately after one-click onboarding). The templates under
// src/runtime/entry-skills/{wf,wfa}/SKILL.md are the source of truth; rendered
// copies are derived artifacts and never enter git (BP-7). The slot layout
// follows docs/entry-skill-locations.md verbatim — that document stays the
// single source of truth for where each client picks commands up.
//
// Overwrite policy (owner rulings 2026-10-13/14, same spirit as the installer
// seed): a slot that already holds a file is NEVER overwritten — existing
// platform-specific texts (codex wfa, zcode wf/wfa) stay, and the outcome is
// recorded as kept-identical or kept-divergent instead. Clients without a
// local command slot are recorded as unplaced (BP-2 time-gap ledger).
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../../core/hash.mjs';
import { targetPath } from '../../core/paths.mjs';
import { parseJson } from '../../core/json.mjs';

// Keep in sync with docs/entry-skill-locations.md. kind: 'skill' →
// <dir>/<id>/SKILL.md, 'command' → <dir>/<id>.md, 'none' → the client has no
// local command slot (registered as unplaced, staging-equivalent).
const SLOTS = {
  codex: { config: 'codex/bridge/runner-config.json', manual: null, kind: 'skill', dir: 'codex/bridge/skills' },
  workbuddy: { config: 'workbuddy/bridge/workbuddy-config.json', manual: 'workbuddy/bridge/invocation-manual.md', kind: 'skill', dir: '.workbuddy/skills' },
  zcode: { config: 'zcode/bridge/zcode-config.json', manual: 'zcode/bridge/invocation-manual.md', kind: 'command', dir: '.zcode/commands' },
  doubao: { config: 'doubao/bridge/doubao-config.json', manual: 'doubao/bridge/invocation-manual.md', kind: 'none', dir: null },
  dsh: { config: 'dsh/bridge/runner-config.json', manual: null, kind: 'none', dir: null },
  qoder: { config: 'qoder/bridge/qoder-config.json', manual: 'qoder/bridge/invocation-manual.md', kind: 'none', dir: null }
};
const SKILLS = ['wf', 'wfa'];

// Same asar-unpack fallback as core/runtime-path.mjs, but SKILL.md does not
// match runtimeFile's extension allowlist, so the resolution lives here.
function templatePath(skill) {
  if (!SKILLS.includes(skill)) throw new Error(`ENTRY_SKILL_UNKNOWN:${skill}`);
  const original = fileURLToPath(new URL(`../../runtime/entry-skills/${skill}/SKILL.md`, import.meta.url));
  const unpacked = original.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`);
  return unpacked !== original && existsSync(unpacked) ? unpacked : original;
}

// D-158 (2026-10-15): the table above is the authoritative slot layout for the
// six surveyed platforms (docs/entry-skill-locations.md). A platform outside it
// is NOT an error -- onboarding a seventh client is a production route
// (domains/intake/platform-body.mjs -> buildOnboardingClientPlan). Such a
// platform gets a derived slot: no local command slot, so the rendered bytes
// still go out into the platform's own runtime staging area, exactly like
// doubao/dsh/qoder (owner ruling 2026-10-14). Anything that is not a usable
// platform id still fails closed. The lookup is own-property only: a bare
// SLOTS[id] read returns Object.prototype members ('constructor', 'toString')
// as truthy values and would let them through silently.
const PLATFORM_ID = /^[a-z][a-z0-9-]{1,30}$/;

export function entrySkillSlots(platformId) {
  const slot = Object.prototype.hasOwnProperty.call(SLOTS, platformId) ? SLOTS[platformId] : null;
  if (slot) return slot;
  if (typeof platformId === 'string' && PLATFORM_ID.test(platformId)) return { config: null, manual: null, kind: 'none', dir: null, derived: true };
  throw new Error(`ENTRY_SKILL_SLOT_UNKNOWN:${platformId}`);
}

function resolvePython(workspaceRoot, platformId, slot) {
  // D-158: a derived slot has no surveyed config path, so probe the two naming
  // shapes the onboarding config step actually writes (<id>-config.json for
  // most platforms, runner-config.json for the codex/dsh shape) before falling
  // through to the bridge rung. A surveyed slot keeps its exact previous
  // behaviour, including the CONFIG_MISSING source it used to report.
  const candidates = slot.config
    ? [slot.config]
    : [`${platformId}/bridge/${platformId}-config.json`, `${platformId}/bridge/runner-config.json`];
  let configSeen = false;
  let configRel = candidates[0];
  for (const rel of candidates) {
    const configAbs = targetPath(workspaceRoot, rel);
    if (!existsSync(configAbs)) continue;
    configSeen = true;
    configRel = rel;
    const config = parseJson(readFileSync(configAbs, 'utf8'));
    const fromConfig = config.interpreters?.['.py'];
    if (fromConfig) return { python: fromConfig, source: `${rel} interpreters['.py']`, configRel: rel };
  }
  if (slot.config && !configSeen) return { python: '', source: 'CONFIG_MISSING', configRel: slot.config };
  const bridgeAbs = targetPath(workspaceRoot, `${platformId}/bridge.json`);
  if (existsSync(bridgeAbs)) {
    const bridge = parseJson(readFileSync(bridgeAbs, 'utf8'));
    if (bridge.runner?.python) return { python: bridge.runner.python, source: 'bridge.json runner.python', configRel };
  }
  return { python: '', source: 'PYTHON_UNRESOLVED', configRel };
}

function renderText(text, vars) {
  let out = text;
  for (const [key, value] of Object.entries(vars)) out = out.split(`{{${key}}}`).join(value);
  return out;
}

// Deterministic: the output depends only on the template bytes plus on-disk
// config bytes, so a plan rebuilt at apply time reproduces the same payload
// (PLAN_PAYLOAD_MISMATCH stays a genuine drift signal, never noise).
export function renderEntrySkills({ workspaceRoot, platformId }) {
  const slot = entrySkillSlots(platformId);
  const workspace = resolve(workspaceRoot);
  const { python, source, configRel } = resolvePython(workspaceRoot, platformId, slot);
  const manualRel = slot.manual || 'invocation-adapters-spec.md';
  const manualAbs = existsSync(targetPath(workspaceRoot, manualRel)) ? targetPath(workspaceRoot, manualRel) : targetPath(workspaceRoot, 'invocation-adapters-spec.md');
  const vars = {
    WORKSPACE_ROOT: workspace,
    PLATFORM_ID: platformId,
    CONFIG_PATH: join(workspace, configRel),
    RUNTIME_TMP: join(workspace, platformId, 'runtime', 'tmp'),
    RUNS_ROOT: join(workspace, platformId, 'runtime', 'runs'),
    PYTHON_EXE: python,
    MANUAL_PATH: manualAbs,
    TOOL_REGISTRY: join(workspace, 'tool', 'registry.json'),
    AGENT_REGISTRY: join(workspace, 'agent', 'registry.json')
  };
  const entries = SKILLS.map((skill) => {
    let content = renderText(readFileSync(templatePath(skill), 'utf8'), vars);
    if (slot.kind === 'command') content = content.replace(/^name: .*\r?\n/m, ''); // zcode command head keeps description only
    const issues = [];
    if (content.includes('{{')) issues.push('RESIDUAL_PLACEHOLDER');
    if (!python) issues.push('PYTHON_UNRESOLVED');
    return {
      skill,
      kind: slot.kind,
      derived: slot.derived === true,
      targetRel: slot.kind === 'none' ? null : slot.kind === 'skill' ? `${slot.dir}/${skill}/SKILL.md` : `${slot.dir}/${skill}.md`,
      existingSha256: slot.kind === 'none' ? null : (existsSync(targetPath(workspaceRoot, slot.kind === 'skill' ? `${slot.dir}/${skill}/SKILL.md` : `${slot.dir}/${skill}.md`)) ? sha256(readFileSync(targetPath(workspaceRoot, slot.kind === 'skill' ? `${slot.dir}/${skill}/SKILL.md` : `${slot.dir}/${skill}.md`))) : null),
      content,
      issues
    };
  });
  return { platformId, vars, entries };
}

// Plan-layer collector: returns only the files that may be written (slots
// currently empty), plus an honest summary of everything that was not.
// Owner ruling 2026-10-14 (fallback for slot-less clients): a client with no
// local command slot still gets the rendered bytes, written to the platform's
// own runtime staging area (<platform>/runtime/entry-skills-export/) for
// manual pickup — auto-generation instead of a silent gap. Staging copies are
// manager-owned derived artifacts and refresh on every run; the
// never-overwrite ruling protects platform slots, not our staging output.
export function collectEntrySkillFiles({ workspaceRoot, platformId }) {
  const rendered = renderEntrySkills({ workspaceRoot, platformId });
  const files = [];
  const keptIdentical = [];
  const keptDivergent = [];
  const unplaced = [];
  const exported = [];
  for (const entry of rendered.entries) {
    if (!entry.targetRel) {
      const exportRel = `${platformId}/runtime/entry-skills-export/${entry.skill}/SKILL.md`;
      files.push({ path: exportRel, content: entry.content });
      exported.push(exportRel);
      // D-162: the staging copy alone never reaches a client that has no local command slot, so the
      // same rendered bytes are also laid out as a plugin package — the shape a Qoder-family client
      // actually loads (`.qoder-plugin/plugin.json` + `skills/<id>/SKILL.md`). The manager still
      // writes nothing into the platform directory or the client's own plugin state.
      const pluginRel = `${platformId}/runtime/entry-skills-export/plugin/ai-workflow-hub/skills/${entry.skill}/SKILL.md`;
      files.push({ path: pluginRel, content: entry.content });
      unplaced.push({ skill: entry.skill, reason: 'NO_LOCAL_COMMAND_SLOT', exportRel, pluginRel });
      continue;
    }
    if (entry.existingSha256) {
      const digest = sha256(entry.content);
      (digest === entry.existingSha256 ? keptIdentical : keptDivergent).push(entry.targetRel);
      continue;
    }
    files.push({ path: entry.targetRel, content: entry.content });
  }
  // D-162: one manifest per exported package, so the directory is a complete plugin rather than a
  // pile of skill files. Placement stays a human step on purpose: whether a given client reads a
  // workspace-level plugin directory is a property of that client, not something to be assumed here.
  const packageRoot = `${platformId}/runtime/entry-skills-export/plugin/ai-workflow-hub`;
  const exportedSkills = unplaced.filter((item) => item.pluginRel).map((item) => item.skill);
  let pluginPackage = null;
  if (exportedSkills.length) {
    const manifestRel = `${packageRoot}/.qoder-plugin/plugin.json`;
    const manifest = {
      name: 'ai-workflow-hub',
      displayName: `AI Workflow Hub (${platformId})`,
      version: '1.0.0',
      description: `统一的 /wf 与 /wfa 入口：按 ${workspaceRoot} 共享工作流与专家仓库的调用协议执行，版本一律解析共享默认，本平台只钉引擎与契约。`
    };
    const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;
    files.push({ path: manifestRel, content: manifestContent });
    pluginPackage = {
      path: packageRoot,
      manifest: manifestRel,
      skills: exportedSkills.map((skill) => `${packageRoot}/skills/${skill}/SKILL.md`),
      placementHint: `把 ${packageRoot} 整个目录放成 ${workspaceRoot}\\${platformId}\\plugins\\ai-workflow-hub（与 qoder 国际版同构的工作区级插件位），或按该客户端自己的插件安装入口装载；管理台不写平台目录、不改客户端插件状态，放置后由客户端加载。`
    };
  }
  const summary = {
    schema: 'entry-skills-plan/v1',
    platformId,
    pluginPackage,
    slotKind: rendered.entries[0]?.kind || 'none',
    derivedSlot: rendered.entries.some((entry) => entry.derived === true),
    files: files.map((file) => file.path),
    keptIdentical,
    keptDivergent,
    unplaced,
    exported,
    issues: rendered.entries.flatMap((entry) => entry.issues.map((issue) => ({ skill: entry.skill, issue })))
  };
  return { files, summary };
}
