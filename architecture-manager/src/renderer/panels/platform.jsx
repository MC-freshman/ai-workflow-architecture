import React from 'react';

const STATUS = {
  'missing-directory': '缺平台目录', 'missing-bridge': '缺 bridge.json', 'bridge-conflict': '配置冲突',
  'invalid-bridge': '配置有误', 'adapter-required': '待适配', 'invalid-runner-config': '客户端配置有误',
  'reference-mismatch': '客户端引用待迁移', configured: '已配置·待检查', callable: '已检查调用·待接入登记',
  complete: '接入完成', 'check-failed': '检查未通过', 'check-cancelled': '检查已取消'
};

export function PlatformPanel({ inventory, showExcluded, setShowExcluded, addPlatformDirectory, previewPlatform, checkPlatform, busy }) {
  return <section className="panel platform-panel">
    <div className="panel-title"><span>平台接入与视图</span><div className="panel-tools"><span className="muted">配置发现；尚非接入认证</span>{inventory && <button className="small-button" onClick={addPlatformDirectory}>添加平台目录</button>}</div></div>
    <div className="rows">
      {(inventory?.platforms || []).filter((platform) => showExcluded || platform.enabled).map((platform) => (
        <div className="row" key={platform.id}>
          <div className="platform-main"><span className="row-name">{platform.id}</span><span className="resource-repo">{platform.directoryRelative}</span><div className="path-line">{platform.directoryPath}</div><div className="marker-list">{platform.markers.map((marker) => <span className={marker.exists ? 'marker good' : 'marker missing'} key={marker.path}>{marker.exists ? '✓' : '×'} {marker.label}</span>)}</div>{platform.bridgeLocation === 'legacy' && <div className="path-line">旧位置可读；标准位置为 {platform.id}/bridge.json</div>}{platform.bridgeConflict && <div className="path-line">两份 bridge.json 内容不同，请先处理冲突；管理台不会自动覆盖。</div>}{(platform.connection?.issues?.length > 0 || platform.connection?.gaps?.length > 0) && <details className="platform-gaps"><summary>查看检查问题与能力缺口（{platform.connection.issues?.length || 0} 条问题 / {platform.connection.gaps?.length || 0} 项缺口）</summary>{(platform.connection.issues || []).map((issue, index) => <p key={index}>{issue}</p>)}{(platform.connection.gaps || []).map((gap) => <p key={gap.id}><strong>{gap.id}</strong> · {gap.verdict}：{gap.reason || '原因未声明'}<br />处置：{gap.remediation || '未声明，需要补充方案'}；成本：{gap.costMinutes ?? '未声明'} 分钟</p>)}</details>}{platform.connection?.commandErrors?.length > 0 && <details className="platform-gaps"><summary>查看检查程序的具体错误</summary>{platform.connection.commandErrors.map((error, index) => <pre key={index}>{error}</pre>)}</details>}</div>
          <div className="resource-actions"><span className={platform.connection?.stage === 'complete' && platform.enabled ? 'pill good' : platform.enabled ? 'pill warn' : 'pill'}>{!platform.enabled ? '已排除视图' : STATUS[platform.connection?.stage] || '发现配置·待自证'}{platform.connection?.evidenceFresh === false ? ' · 上次检查缓存' : ''}</span>{['configured', 'callable', 'complete', 'check-failed', 'check-cancelled'].includes(platform.connection?.stage) && <><button className="small-button" disabled={busy} onClick={() => checkPlatform(platform, 'quick')}>检查受影响调用</button><button className="small-button" disabled={busy} onClick={() => checkPlatform(platform, 'full')}>接入认证（自动选格）</button></>}{inventory && <button className="small-button" onClick={() => previewPlatform(platform)}>{platform.enabled ? '排除视图' : '加入视图'}</button>}{platform.connection?.checkedAt && <small className="muted">上次：{new Date(platform.connection.checkedAt).toLocaleString()}</small>}</div>
        </div>
      ))}
      {inventory && <label className="show-excluded"><input type="checkbox" checked={showExcluded} onChange={(event) => setShowExcluded(event.target.checked)} /> 显示已排除视图的平台</label>}
      {!inventory && <div className="empty">选择工作区后显示平台。添加前会检查目录和 bridge 标记文件。</div>}
    </div>
  </section>;
}
