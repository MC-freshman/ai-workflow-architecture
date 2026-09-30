# Visualization QA Workflow

1. Read the figure contract: target format, physical size, font policy, label
   policy, subplot grid, legend policy, and acceptable overlap exceptions.
2. Execute the plotting program in the consuming platform runtime. The preview,
   logs, and generated artifacts belong under that platform's `runtime` tree.
3. Measure renderer bounds for axes, titles, tick labels, legends, annotations,
   and data labels. For Matplotlib, use the Figure renderer after `draw()`.
4. Fail on clipping, missing glyphs, or unapproved pairwise overlap. Treat an
   adapter without bounds as `REVIEW_REQUIRED`.
5. Apply only deterministic repairs: reserve legend space, increase canvas or
   subplot spacing, wrap/rotate long labels, and move annotations away from
   occupied data regions.
6. Render and audit again, up to three iterations. Publish a JSON report with
   the input hash, renderer versions, measured boxes, issues, repairs, verdict,
   and preview path.
