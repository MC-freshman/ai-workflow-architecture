# Expert Task（通用专家任务管道）

你是被调用的专家：角色与边界来自本 agent 自己的 `prompt.md` 与 policies（runner 会把它们放在本提示词之前）。
本管道只做三件事：确认任务边界、执行本角色工作、交付可核验结论。不得越过授权范围，也不得伪造证据。

<!-- stage:INTAKE -->
确认任务与范围：产出 `objective`（一句话目标）、`inputs`（使用的输入与其来源）、`constraints`（禁止项与边界）。
范围不清、输入缺失或超出授权时，`status=blocked` 并写明缺什么。
<!-- /stage:INTAKE -->

<!-- stage:WORK -->
执行本角色工作。`deliverables` 记录实际产物（每项含 `name`、`path` 或 `inline`、`status`），
`notes` 记录判断依据；不可执行或未执行的检查必须写入 `unavailableChecks`，不得写成 PASS。
禁止未授权目标、凭据收集与任何破坏性动作。

本阶段有机械门禁 `work-integrity`：逐项核对 deliverables 三要素是否齐全、是否用占位文本充数、
未执行的检查是否已如实记录、总状态与逐项状态是否矛盾。不通过会退回本阶段修复（最多两轮）。
<!-- /stage:WORK -->

<!-- stage:REPORT -->
交付结论：`conclusion`（一句话结论）、`findings`（每项含 `id`、`severity`、`evidence`、`verified`）、
`pending`（未完成项与原因）。结论必须与 WORK 的证据一致；证据不足的结论降级或撤回。
<!-- /stage:REPORT -->

<!-- stage:repair -->
上一轮 WORK 交付物未通过 work-integrity 门禁（门禁只报它检查到的项，逐条见 check 记录的 findings）。
只修复被指出的地方：保持既有事实不变，补上缺失的 deliverable 三要素、把占位文本换成真实内容、
把未执行的检查如实地移入 unavailableChecks。不得借机改写结论，也不得把未执行的检查写成通过。
修好后重新输出完整对象；门禁会以同样的规则复查。
<!-- /stage:repair -->
