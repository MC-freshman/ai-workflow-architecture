---
name: research-paper-card
description: >-
  单篇论文深度分析资源包。按来源约束生成 01–16 节 Paper Card，覆盖研究问题、方法模块、
  关键公式、实验—结论证据链、结论边界、作者自述局限、批判分析和可检验的研究想法。
  适用于论文深度分析、精读卡、方法拆解、证据链审计、结论边界分析。
---

本 skill 是钉版资源包，不是常驻大上下文。根目录从本次 `run-lock.json` 的 `resources` 中找到
`id=research-paper-card` 的 `path`；以下路径都相对该根目录。

执行顺序：

1. 先读 `upstream/nature-paper-card/SKILL.md`，按它的路由协议确定 paper_type，并加载它指定的
   `upstream/nature-paper-card/manifest.yaml`、`static/` 与 `references/` 片段。不要凭记忆套用卡片结构。
2. 共享核心在 `upstream/nature-shared/`；`nature-paper-card/manifest.yaml` 里的
   `../nature-shared/...` 会解析到该目录。
3. 优先使用已有的 `paper-reader` 产物或 `source_map.json`；没有时用
   `upstream/nature-paper-card/scripts/prepare_paper.py` 处理 PDF。PDF 解析脚本需要 Python 3.10+
   与 PyMuPDF 1.26+；环境缺失时写入 `unavailableChecks`，不得凭摘要生成完整卡片。
4. 单批读取不超过 4000 估算 token；区分作者陈述、外部事实、自己的分析与研究假设。产物写到本次
   run 的 work 目录，不写共享项目路径。
5. 初稿完成后必须运行 `upstream/nature-paper-card/scripts/audit_paper_card.py`，保留
   `audit-report.json`；审计不通过先修卡片，不把未审计稿称为完成。
6. 交付：`paper-card.md`、`source_bundle.json`、`audit-report.json`。
