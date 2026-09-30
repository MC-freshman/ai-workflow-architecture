# Game pipeline (scenario-selected execution)

<!-- stage:EXECUTE -->
做本次运行所选**场景**的执行工作。判断标准、拒绝条件与产物形状由提示词上下文里注入的场景技能给出；上下文里没有场景技能时，按 `standard` 的通用要求交付：给出可核对的结论、列出证据与未决项。
不得声称做过没有做过的检查；不得把示例数据当实测结果。
<!-- /stage:EXECUTE -->

<!-- stage:EXECUTE-REPAIR -->
按门禁反馈修复上一轮产物后重交：逐条说明改了哪里、依据哪条反馈。
<!-- /stage:EXECUTE-REPAIR -->

<!-- stage:SELFCHECK -->
对上一阶段产物做自检：形状是否合契约、证据是否可回读、有没有把推断写成实测。
<!-- /stage:SELFCHECK -->

