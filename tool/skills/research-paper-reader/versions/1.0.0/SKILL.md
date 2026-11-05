---
name: research-paper-reader
description: >-
  论文精读与讲解资源包。把 PDF、DOI、arXiv、出版社 HTML 或粘贴文本转成中英对照全文，
  图表与公式放在对应正文附近，并为每段/图/表/公式建立 source map。适用于读论文、精读论文、
  论文翻译、文献阅读、帮我读这篇文章、翻译这篇 paper。
---

本 skill 是钉版资源包，不是常驻大上下文。根目录从本次 `run-lock.json` 的 `resources` 中找到
`id=research-paper-reader` 的 `path`；以下路径都相对该根目录。

执行顺序：

1. 先读 `upstream/nature-reader/SKILL.md`，按它的路由协议检测 source_format，并加载它指定的
   `upstream/nature-reader/manifest.yaml` 与 `static/`、`references/` 片段。不要凭记忆套用阅读流程。
2. 共享核心在 `upstream/nature-shared/`；`nature-reader/manifest.yaml` 里的 `../nature-shared/...`
   会解析到该目录。
3. 输入取本次任务的 paper 文件、DOI、arXiv 链接、HTML 或粘贴文本；不得用摘要冒充全文。全文缺失或
   只有摘要时，交付标为 `partial` 或 `blocked`，并列出缺什么。
4. 单批读取不超过 4000 估算 token；记录资源 ID、版本、文件 sha256 与行范围。产物写到本次 run 的
   work 目录，不写共享项目路径。
5. 脚本只在平台提供 Python 3.10+ 与 PyMuPDF 1.26+ 时执行；环境缺失时写入 `unavailableChecks`，
   不得声称已解析 PDF。
6. 交付：`paper.md`、`source_map.json`、`translation_notes.md`、`assets/`（图表裁剪按需）。
