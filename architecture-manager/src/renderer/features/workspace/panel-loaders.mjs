// Panel wiring for the registry-driven renderer (P3/P4, approved P-table 20261111).
// Composition (which panels in which view, order, groups, enabled, replacement) lives in
// src/app/module-registry.json (derived from app/view-definitions.json). This file only maps
// panel module ids to local lazy loaders + prop adapters. No remote code (CSP local-only).
// Replacement implementations register here under a new id and are activated via the
// registry module's `replacement` field after passing contract tests (docs/module-replacement.md).
export const panelLoaders = {
  'panel-anchor': { load: () => import('../../panels/anchor.jsx'), pick: ['AnchorPanel'] },
  'panel-audit': { load: () => import('../../panels/audit.jsx'), pick: ['AuditPanel'] },
  'panel-body-intake-panel': { load: () => import('../intake/BodyIntakePanel.jsx'), pick: ['BodyIntakePanel'], keyedBySession: true },
  'panel-catalog': { load: () => import('../../panels/catalog.jsx'), pick: ['CatalogPanel'] },
  'panel-cockpit': { load: () => import('../../panels/cockpit.jsx'), pick: ['CockpitPanel'] },
  'panel-clone': { load: () => import('../../panels/clone.jsx'), pick: ['ClonePanel'] },
  'panel-documents': { load: () => import('../../panels/documents.jsx'), pick: ['DocumentPanel'] },
  'panel-git': { load: () => import('../../panels/git.jsx'), pick: ['GitPanel'] },
  'panel-global-update': { load: () => import('../../panels/global-update.jsx'), pick: ['GlobalUpdatePanel'] },
  'panel-governance': { load: () => import('../../panels/governance.jsx'), pick: ['GovernancePanel'] },
  'panel-inbox': { load: () => import('../../panels/inbox.jsx'), pick: ['InboxPanel'] },
  'panel-integration': { load: () => import('../../panels/integration.jsx'), pick: ['IntegrationPanel'] },
  'panel-onboard': { load: () => import('../../panels/onboard.jsx'), pick: ['OnboardPanel'] },
  'panel-plan-preview': { load: () => import('../../panels/plan-preview.jsx'), pick: ['PlanPreview'] },
  'panel-plancenter': { load: () => import('../../panels/plancenter.jsx'), pick: ['PlanCenterPanel'] },
  'panel-platform': { load: () => import('../../panels/platform.jsx'), pick: ['PlatformPanel'] },
  'panel-platform-resource-versions': { load: () => import('../../panels/platform-resource-versions.jsx'), pick: ['PlatformResourceVersions'] },
  'panel-pulse': { load: () => import('../../panels/pulse.jsx'), pick: ['HomePulse'] },
  'panel-releases': { load: () => import('../../panels/releases.jsx'), pick: ['ReleasePanel'] },
  'panel-resources': { load: () => import('../../panels/resources.jsx'), pick: ['ResourcePanel'] },
  'panel-runs': { load: () => import('../../panels/runs.jsx'), pick: ['RunsPanel'] },
  'panel-run-timeline': { load: () => import('../../panels/run-timeline.jsx'), pick: ['RunTimelinePanel'] },
  'panel-safety': { load: () => import('../../panels/safety.jsx'), pick: ['SafetyPanel', 'HelpPanel'] },
  'panel-software': { load: () => import('../../panels/software.jsx'), pick: ['SoftwarePanel'] },
  'panel-stats': { load: () => import('../../panels/stats.jsx'), pick: ['DashboardStats'] }
};

// Prop aliases for panels whose historical prop names differ from the controller model.
export const panelPropAdapters = {
  'panel-anchor': (model) => ({ report: model.anchorReport }),
  'panel-git': (model) => ({ platforms: model.inventory?.platforms }),
  'panel-plancenter': (model) => ({ onOpenDocument: (path) => { model.setView('documents'); model.openDocument(path); } }),
  'panel-clone': (model) => ({ onCloned: (root) => model.scan(root) })
};

// P4 pilot replacement implementations. A replacement is activated only when a module's
// `replacement` field (via app/module-overrides.json) names one of these ids AND its contract
// tests pass (test/module-replacement-pilot.test.mjs). Never active by default.
export const replacementLoaders = {
  'panel-runs-alt': { load: () => import('./pilot/runs-alt-panel.jsx'), pick: ['RunsAltPanel'] },
  'panel-audit-alt': { load: () => import('./pilot/audit-alt-panel.jsx'), pick: ['AuditAltPanel'] }
};