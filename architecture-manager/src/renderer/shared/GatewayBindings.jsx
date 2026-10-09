import React from 'react';

export function GatewayBindings({binding,workspace,platformId,api,act,working}) {
  if(!binding?.alternatives?.length)return null;
  return <div className="notice gateway-bindings"><strong>软件配置来源核对</strong><p className="path-line">当前使用：{binding.path}</p><p>旧文件仅作比较，不会自动覆盖当前配置。需要恢复遗漏绑定时，选择下面的迁移计划；来源原件保留。</p>{binding.selectionRequired && <p role="alert">尚未指定唯一生效配置，请先确认迁移选择，再保存接入配置。</p>}{binding.alternatives.map(row=><div key={row.path}><p className="path-line">其它文件：{row.path}</p><p>缺少项：{row.missing.join('、') || '无'}；差异项：{row.conflicts.join('、') || '无'}{row.error?'；文件无法读取，请先检查该文件。':''}</p><div className="git-actions"><button className="small-button" disabled={working || Boolean(row.error)} onClick={()=>act(()=>api.previewGatewayMigrationPlan({workspaceRoot:workspace,platformId,sourcePath:row.path,conflictChoice:'active'}),'迁移计划已生成：补齐缺少项，差异保留当前值。')}>预览迁入缺少项（保留当前差异项）</button><button className="small-button" disabled={working || Boolean(row.error)} onClick={()=>act(()=>api.previewGatewayMigrationPlan({workspaceRoot:workspace,platformId,sourcePath:row.path,conflictChoice:'source'}),'迁移计划已生成：差异项采用所选来源，请仔细核对后确认。')}>预览迁入并采用此文件差异项</button></div></div>)}</div>;
}
