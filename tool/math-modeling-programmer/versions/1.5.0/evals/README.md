# 行为评测集

`cases.json` 用于检查 Skill 在典型编程手场景中的行为。它不要求固定措辞，评测应关注
是否识别风险、是否保留证据、是否在缺少条件时阻止阶段推进。

每个场景包含 `prompt`、`expected_invariants` 和 `failure_modes`。可让不同模型分别回答，
再依据 `scoring.md` 评分。测试数据与正式题目分离，不应直接把参考答案塞入提示词。
