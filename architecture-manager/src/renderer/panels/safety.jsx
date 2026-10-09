import React from 'react';

export function SafetyPanel() {
  return <section className="panel"><div className="panel-title"><span>安全边界</span><span className="muted">P1–P4</span></div><ul className="checks"><li><span className="check">✓</span>页面没有 Node 文件系统权限</li><li><span className="check">✓</span>扫描器明确标记 writePerformed=false</li><li><span className="check">✓</span>路径越界在 API 层拒绝</li><li><span className="check">✓</span>后续写入必须经过计划层</li></ul></section>;
}

export function HelpPanel() {
  return <section className="panel help-panel"><div className="panel-title"><span>新手操作</span><span className="muted">维护接入不需要 AI 会话或控制台</span></div><ol className="help-list"><li>选择自己的架构工作区；每个人使用独立副本，配置、软件和凭据归自己所选平台。</li><li>新增任何本体：打开「导入本体」，选择平台／智能体／技能／工作流／软件，再选文件、完整文件夹或普通 ZIP。识别不执行来源里的指令，原件保留。</li><li>智能体与技能：确认正文、ID、版本和精确依赖，预览发布。工作流：用阶段表单填写说明、提示词或脚本；确认发布不会擅自执行业务。</li><li>平台客户端：安置本体，填写解释器和真实客户端接口，再到「平台与接入」准备环境、真实探测、认证和登记。只有原生接口、能力地板和首次认证都通过才算接入完成；登录、系统安装、UAC 仍需本人操作。</li><li>软件：先安置并回读。普通 CLI 可声明参数和只读测试；GUI 可启动、检查存活和关闭本次会话；已有 MCP 配置用实际连接入口读取工具并确认权限。版本查询、启动与业务功能分别显示，不互相代替。</li><li>更新与撤销：使用同一个 ID 发布新版本。在「资源」或「软件」查看当前版本和全文；在「导入记录」继续中断计划或撤销登记。冻结版本、原件与备份保留。</li><li>在「仓库」刷新，勾选本次改动并提交，才有可回滚基线；再预览上传 GitHub、历史备份或回滚。凭据与软件本体不入库；GitHub 登录可使用本机已有凭据，不在配方里填密码。</li><li>计划中心读取文档表头和状态；更新说明用「文档」编辑并确认。每项写入先看计划，结果在顶部固定状态条显示；「排除视图」仅隐藏，不删除平台。</li></ol></section>;
}
