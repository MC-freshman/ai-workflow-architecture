import React from 'react';
import {cancelTaskProgress} from './task-client.mjs';

const seconds = (value) => (value / 1000).toFixed(1);

const ONBOARDING_STEPS = [
  'configuration', 'backend', 'environment', 'providers', 'client',
  'capabilities', 'l1-dual-cell', 'native', 'certification', 'governance', 'git'
];

const STEP_ALIASES = {
  'client-tool-loop': 'client',
  'post-alignment-check': 'certification'
};

const STEP_LABELS = {
  configuration: '配置与版本',
  backend: '隔离后端',
  environment: '运行环境',
  providers: '平台 provider',
  client: '服务通道',
  capabilities: '能力实测',
  'l1-dual-cell': 'wf/wfa 调用',
  native: '厂商原生',
  certification: '完整认证',
  governance: '治理登记',
  git: 'Git 提交'
};

const labelFor = (id) => STEP_LABELS[id] || id;

function resolveSteps(progress) {
  if (Array.isArray(progress.platformIds) && progress.platformIds.length > 0) {
    const done = new Set(progress.done || []);
    const completed = Number.isInteger(progress.completed) ? progress.completed : 0;
    const steps = progress.platformIds.map((id, index) => ({
      key: id,
      label: id,
      done: done.has(id) || index < completed,
      active: id === progress.targetPlatformId
    }));
    return {steps, total: steps.length};
  }
  const phaseKey = STEP_ALIASES[progress.phase] || progress.phase;
  if (typeof phaseKey === 'string' && ONBOARDING_STEPS.includes(phaseKey)) {
    const activeIndex = ONBOARDING_STEPS.indexOf(phaseKey);
    const steps = ONBOARDING_STEPS.map((id, index) => ({
      key: id,
      label: labelFor(id),
      done: index < activeIndex,
      active: index === activeIndex
    }));
    return {steps, total: steps.length};
  }
  if (Number.isInteger(progress.total) && progress.total > 0 && progress.total <= 8) {
    const completed = Number.isInteger(progress.completed) ? progress.completed : 0;
    const activeIndex = completed < progress.total ? completed : -1;
    const steps = Array.from({length: progress.total}, (_, index) => ({
      key: String(index),
      label: `步骤 ${index + 1}`,
      done: index < completed,
      active: index === activeIndex
    }));
    return {steps, total: progress.total};
  }
  return null;
}

export function TaskProgress({progress, api, workspace, session, setMessage}) {
  if (!progress) return null;
  const timings = progress.timings;
  const phase = progress.phase || progress.stage || '处理中';
  const steps = resolveSteps(progress);
  const doneCount = steps ? steps.steps.filter((step) => step.done).length : 0;
  const activeIndex = steps ? steps.steps.findIndex((step) => step.active) : -1;
  const stepValue = steps
    ? Math.min(steps.total, doneCount + (activeIndex >= 0 ? 0.5 : 0))
    : 0;
  const barValue = progress.bytesDone ?? progress.filesDone ?? (steps ? stepValue : progress.completed);
  const barMax = progress.bytesTotal || progress.filesTotal || (steps ? steps.total : Math.max(progress.total || 0, progress.completed || 1));
  const stepText = steps
    ? activeIndex >= 0
      ? `正在第 ${activeIndex + 1} / ${steps.total} 步`
      : `已完成 ${doneCount} / ${steps.total} 步`
    : Number.isInteger(progress.total) && progress.total > 0
      ? `已完成 ${progress.completed || 0} / ${progress.total} 格`
      : '';

  return <div className="progress-card" role="status" aria-live="polite">
    <div className="progress-head">
      <div className="progress-title">
        <span className="progress-kicker">执行进度</span>
        <strong>{phase}</strong>
        {progress.reused && <span className="progress-reused">复用有效证据</span>}
      </div>
      {stepText && <span className="progress-count">{stepText}</span>}
    </div>

    {steps && <div className={`progress-steps${steps.total > 8 ? ' compact' : ''}`} aria-label="执行步骤">
      {steps.steps.map((step, index) => {
        const state = step.done ? 'done' : step.active ? 'active' : 'todo';
        return <React.Fragment key={step.key}>
          <div className={`progress-step ${state}`} aria-current={state === 'active' ? 'step' : undefined} title={step.label}>
            <span className="progress-step-dot">{state === 'done' ? '✓' : index + 1}</span>
            <span className="progress-step-label">{step.label}</span>
          </div>
          {index < steps.steps.length - 1 && <span className={`progress-arrow ${state === 'done' ? 'done' : ''}`} aria-hidden="true">→</span>}
        </React.Fragment>;
      })}
    </div>}

    <progress
      value={barValue}
      max={barMax}
      aria-label={steps ? `执行进度：${stepText}` : '执行进度'}
    />

    <div className="progress-meta">
      {Number.isInteger(progress.completed) && !steps && progress.total && <span>已完成 {progress.completed}/{progress.total}</span>}
      {progress.path && <span title={progress.path}>{progress.path}</span>}
      {Number.isFinite(progress.durationMs) && <span>本格 {seconds(progress.durationMs)} 秒</span>}
      {Number.isFinite(progress.remainingEstimateMs) && progress.remainingEstimateMs > 0 && <span>预计剩余约 {seconds(progress.remainingEstimateMs)} 秒</span>}
      {timings && <span>准备 {seconds(timings.prepareMs || 0)}s / 领取 {seconds(timings.nextMs || 0)}s / 收口 {seconds(timings.stopMs || 0)}s</span>}
      {Number.isFinite(progress.downloadedBytes) && <span>已下载 {(progress.downloadedBytes / 1048576).toFixed(1)} MB</span>}
      {Number.isFinite(progress.rateBytesPerSecond) && <span>{Math.max(0, Math.round(progress.rateBytesPerSecond / 1024))} KB/s</span>}
    </div>

    {(progress.jobId || progress.platformId) && progress.cancellable !== false && <button className="small-button" onClick={async () => {
      const accepted = await cancelTaskProgress(api, progress, workspace, session);
      setMessage(accepted ? '已请求停止，正在等待本轮进程回收与安全写入收口。' : '任务已收口，或会话已交给软件 provider。');
    }}>停止本次操作</button>}
  </div>;
}
