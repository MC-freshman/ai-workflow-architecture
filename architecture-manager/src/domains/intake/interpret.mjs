export function interpretation(type,files,entry) {
  const selected=files.find(row=>row.path===entry),text=selected?.text;
  const models={
    agent:{strategy:'agent-prompt',description:'保留专家原文，生成专家 manifest、精确工作流锁与新版本登记。',generatedFiles:['manifest.json','prompt.md','tool-lock.json','SOURCE.json','SHA256SUMS']},
    skill:{strategy:'skill-text',description:'保留 SKILL.md 和文本附件，生成共享技能版本及 catalog。',generatedFiles:['manifest.json','SOURCE.json','SHA256SUMS','catalog 登记']},
    tool:{strategy:text && /\.(py|js|mjs|ps1|sh)$/i.test(entry || '')?'script-workflow':'prompt-or-defined-workflow',description:'从说明、定义或脚本生成合法阶段、输入输出 schema、工作流与精确依赖。程序本体归软件。',generatedFiles:['manifest.json','workflow.yaml','schemas/input.json','schemas/output.json','SOURCE.json','SHA256SUMS']},
    platform:{strategy:'client-binding',description:'本体或配置归所属平台，选择客户端模板并生成环境、provider 与实际客户端验证计划。',generatedFiles:['平台 bridge 配置','平台 runtime 环境/入口','原生注册计划','真实回执']},
    software:{strategy:selected?.installer?'installer-staging':/\.json$/i.test(entry || '')?'mcp-configuration':'software-body',description:selected?.installer?'先安置安装包；完成系统安装后绑定真正的程序。安置不等于安装成功。':'本体与备份归所属平台，共享仓仅发布文本配方与实际测到的能力。',generatedFiles:['平台 runtime 本体/绑定','inbox/backup 平台备份','共享软件配方/SOURCE/SHA256SUMS','真实快照']}
  };
  return {...models[type],entryConfirmed:Boolean(entry),confirmationRequired:true,sourceEntries:files.filter(row=>row.included).map(row=>row.path),instructionsExecuted:false};
}
