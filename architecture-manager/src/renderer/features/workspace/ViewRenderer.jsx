// Registry-driven view renderer (P3, approved P-table 20261111).
// Composition comes from src/app/module-registry.json (views[] + modules[].enabled/replacement);
// local lazy loaders come from panel-loaders.mjs. Detached modules render a unified empty state.
// Status color semantics follow the three-layer badge convention: good=达成, warn=辅助/待定, bad=失败.
import React, { Component, Suspense, lazy } from 'react';
import registry from '../../../app/module-registry.json';
import { panelLoaders, replacementLoaders, panelPropAdapters } from './panel-loaders.mjs';

const LOADERS = { ...panelLoaders, ...replacementLoaders };
const LAZY = {};
for (const [id, wiring] of Object.entries(LOADERS)) {
  for (const name of wiring.pick) {
    LAZY[id + ':' + name] = lazy(() => wiring.load().then((module) => ({ default: module[name] })));
  }
}

export function ModuleEmptyState({ title, detail }) {
  return (
    <div className="module-empty-state" role="note">
      <div className="module-empty-state-title">{title}</div>
      {detail ? <div className="module-empty-state-detail">{detail}</div> : null}
    </div>
  );
}

class PanelErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return <ModuleEmptyState title="模块加载失败" detail={String(this.state.error?.message || this.state.error)} />;
    }
    return this.props.children;
  }
}

function PanelSlot({ panelId, model }) {
  const module = registry.modules.find((entry) => entry.id === panelId);
  if (!module) return <ModuleEmptyState title="模块未注册" detail={panelId} />;
  if (module.enabled === false) {
    return <ModuleEmptyState title="模块已拆卸" detail={`${module.id} · 注册表 enabled=false；恢复启用后重建即可重组`} />;
  }
  const target = module.replacement || panelId;
  const wiring = LOADERS[target];
  if (!wiring) return <ModuleEmptyState title="替换实现未注册" detail={`${target} · 先在 panel-loaders 注册并通过契约测试`} />;
  const adapter = panelPropAdapters[target] || panelPropAdapters[panelId];
  const extra = adapter ? adapter(model) : {};
  return (
    <PanelErrorBoundary>
      <Suspense fallback={<div className="panel-loading">模块载入中…</div>}>
        {wiring.pick.map((name) => {
          const LazyComponent = LAZY[target + ':' + name];
          return <LazyComponent key={name} {...model} {...extra} />;
        })}
      </Suspense>
    </PanelErrorBoundary>
  );
}

export function ViewRenderer({ viewId, model }) {
  const definition = registry.views.find((view) => view.id === viewId);
  if (!definition) return null;
  const sections = definition.sections || [{ label: null, panels: definition.panels }];
  return (
    <>
      {sections.map((section, index) => {
        const slots = section.panels.map((panelId) => {
          const keyed = LOADERS[panelId]?.keyedBySession ? panelId + ':' + model.workspaceSession : panelId;
          return <PanelSlot key={keyed} panelId={panelId} model={model} />;
        });
        if (!section.label) return <React.Fragment key={index}>{slots}</React.Fragment>;
        return (
          <section className="panel-section" key={section.label}>
            <h3 className="panel-section-title">{section.label}</h3>
            {slots}
          </section>
        );
      })}
    </>
  );
}