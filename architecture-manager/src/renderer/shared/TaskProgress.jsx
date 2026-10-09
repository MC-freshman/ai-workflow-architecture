import React from 'react';
import {cancelTaskProgress} from './task-client.mjs';

const seconds=value=>(value/1000).toFixed(1);
export function TaskProgress({progress,api,workspace,session,setMessage}) {
  if(!progress) return null;
  const timings=progress.timings;
  return <div className="notice" role="status">
    正在处理：{progress.phase || progress.stage}{progress.reused?'（复用有效证据）':''}
    {progress.path && ` · ${progress.path}`}
    {Number.isInteger(progress.completed) && ` · 已完成 ${progress.completed}/${progress.total} 格`}
    {Number.isFinite(progress.durationMs) && ` · 本格 ${seconds(progress.durationMs)} 秒`}
    {timings && <span> · 准备 {seconds(timings.prepareMs || 0)} 秒 / 领取 {seconds(timings.nextMs || 0)} 秒 / 收口 {seconds(timings.stopMs || 0)} 秒 / 初始化 {seconds(timings.initializationMs || 0)} 秒 / 启动与传输 {seconds(timings.transportAndStartupMs || 0)} 秒</span>}
    {Number.isFinite(progress.remainingEstimateMs) && progress.remainingEstimateMs>0 && ` · 预计剩余约 ${seconds(progress.remainingEstimateMs)} 秒（按已完成格估算）`}
    <progress value={progress.bytesDone ?? progress.filesDone ?? progress.completed} max={progress.bytesTotal || progress.filesTotal || Math.max(progress.total || 0,progress.completed || 1)} />
    {(progress.jobId || progress.platformId) && progress.cancellable!==false && <button className="small-button" onClick={async()=>{
      const accepted=await cancelTaskProgress(api,progress,workspace,session);
      setMessage(accepted?'已请求停止，正在等待本轮进程回收与安全写入收口。':'任务已收口，或会话已交给软件 provider。');
    }}>停止本次操作</button>}
  </div>;
}
