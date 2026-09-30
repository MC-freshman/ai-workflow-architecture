# 图表渲染与碰撞 QA

V1.1 将 FIGURES 阶段拆为四个确定性门和一个视觉复核门：

```text
源代码预检 -> 渲染 PNG -> 内存布局检查 -> 最终 PDF 几何检查 -> 视觉复核
```

绘图源码必须提供 `build_figure()`，返回 Matplotlib `Figure`。工作流在隔离进程中设置
`MPLBACKEND=Agg`，只允许项目内相对路径，并把预览、报告和诊断文件写到项目的
`figures/qa/<figure-id>/<iteration>/`。

## 确定性检查

- `visual_qa.py`：缺字、文字越界、刻度包围盒重叠；
- `layout_tools.py`：constrained/tight layout 和统一子图标签；
- `audit_panel_alignment.py`：最终物理尺寸下的 plot-area 行列边界、宽高、间距和标签锚点；
- `audit_figure_collisions.py`：最终 PDF 的文字-文字、文字-线条、页面裁切和可疑填充边缘；
- `audit_pdf_text.py`：实际 PDF 字体运行大小，防止数学上下标小于字号下限；
- `validate_figure.py`：绘图源码的静态预检。直接运行时，多面板源码应显式调用运行时对齐门；
  由 `run_figure_qa.py` 编排时，编排器会在渲染后执行同一门，静态检查通过
  `--runtime-panel-gate` 标记这一责任边界。编排器也会通过 `--runtime-exports` 声明由
  契约控制并统一生成最终 SVG/PDF/PNG，源码无需重复写导出语句。
- `audit_pdf_text.py`：扫描最终 PDF 的 `Tf` 文本运行，检查实际字号是否低于契约中的 `min_pt`。

PDF 阶段会同时写出 `collision.json`、`pdf_text.json` 和仅供诊断的
`collision_diagnostic.pdf`。诊断 PDF 在原图上标出 FAIL/WARN 包围盒，不能替代原始 PDF，也不能
作为论文提交文件。

PyMuPDF 缺失时，PDF 几何检查为 `NOT_RUN/BLOCKED`，不得报告为通过。填充区域内部的文字
可能是热图值或柱内标签，只能作为 WARN，由视觉复核确认。

## 视觉复核

PNG 必须在最终物理尺寸下生成。视觉复核记录绑定 `preview_sha256` 和 `qa_report_sha256`，
逐项记录字形、裁切、图例遮挡、标注重叠、面板对齐、灰度/色盲和数据范围。只有所有检查
为 `PASS` 才能把登记表状态设为 `CHECKED` 或 `FROZEN`。

每次改变字体、文字、图例、注释、子图尺寸、数据或导出格式，都必须递增 iteration 并重跑
全部检查。最多自动修复三轮；仍未通过时进入 `BLOCKED`。

## 绘图约定

- 外置图例使用独立区域或可测量的 `bbox_to_anchor`，不得覆盖数据；
- 长分类标签优先换行、旋转或减少刻度，不得静默截断；
- 数据标注位置从数据和误差上界计算，不使用固定的 `LABEL_Y`；
- inset、colorbar 和不等宽 hero panel 必须从对齐组排除或写明精确豁免原因；
- 不用白色不透明框遮住曲线来伪造清晰度。
