# Visualization QA Workflow

<!-- stage:execute -->
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

Gate evidence contract (checked by the runner before this stage can pass):

- Seal the rendered preview as `qa/preview.png` (at least 1024 bytes).
- Seal the QA report as `qa/report.json` with exactly these runner-checked
  fields: `verdict` (must be `"PASS"`), `previewSha256` (the SHA-256 of the
  sealed preview — a changed preview invalidates the report), `measuredBoxes`
  (non-empty list of `{element, box:[x0,y0,x1,y1]}`), `clipping` (`"PASS"`),
  `overlap` (`"PASS"`), and `artifactsRuntimeRooted` (`true`).
- The five gates re-derive these checks from the sealed bytes; do not claim a
  status you have not verified against the sealed artifacts.
<!-- /stage:execute -->

<!-- stage:repair -->
Re-run only the failing facets deterministically. For each failed gate class,
apply the matching step-5 repair (reserve legend space, increase canvas or
subplot spacing, wrap/rotate long labels, move annotations), re-render the
preview, re-measure, and rewrite `qa/report.json` with the new `previewSha256`
and facet values. Seal the new preview and report under this attempt's evidence
directory. Never relax a gate, never edit a sealed earlier attempt, and never
mark a facet PASS without re-measuring.
<!-- /stage:repair -->
