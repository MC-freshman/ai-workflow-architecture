# Visualization Layout and Geometry Audit

Use this skill whenever generated plotting code contains long labels, multiple
subplots, external legends, annotations, or publication-size output.

The required loop is: render the actual figure in the consuming platform's
runtime, measure the renderer's element bounds, report clipping and overlap,
apply a deterministic layout repair, and render again. A text-only inspection
is not evidence that a layout passes.

For Matplotlib figures, call `scripts/visual_qa.py` on the Figure object before
export. Use `scripts/geometry_audit.py` on renderer-produced element boxes to
detect subplot, legend, text, and annotation collisions. Use
`scripts/layout_tools.py` for constrained layout, panel labels, and stable
margins. Use `scripts/check_figure.py` for output format, DPI, and PDF font
checks. Runtime artifacts and previews must stay outside this published Skill
directory.

If an adapter cannot expose reliable element bounds, return `REVIEW_REQUIRED`
instead of claiming that the figure is collision-free.
