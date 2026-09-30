import matplotlib as mpl
import matplotlib.pyplot as plt

from audit_panel_alignment import require_matplotlib_panel_alignment
from layout_tools import add_panel_labels, finalize_figure


mpl.rcParams.update({
    "font.family": "sans-serif",
    "font.sans-serif": ["Arial", "DejaVu Sans"],
    "font.size": 7,
    "svg.fonttype": "none",
    "pdf.fonttype": 42,
})


def build_figure():
    fig, axes = plt.subplots(1, 2, figsize=(7.2, 3.2), constrained_layout=True)
    x = [0, 1, 2, 3]
    axes[0].plot(x, [1.0, 1.4, 1.8, 2.0], label="Method X", linewidth=1.4)
    axes[0].plot(x, [0.8, 1.0, 1.2, 1.3], label="Baseline", linewidth=1.0, linestyle="--")
    axes[0].set_xlabel("Iteration (step)")
    axes[0].set_ylabel("Score (a.u.)")
    axes[0].set_title("Primary comparison")
    axes[0].legend(loc="upper left", frameon=False)

    axes[1].bar([0, 1, 2], [0.42, 0.55, 0.63], color=["#0072B2", "#E69F00", "#009E73"])
    axes[1].set_xticks([0, 1, 2], ["low", "medium", "high"])
    axes[1].set_xlabel("Perturbation level")
    axes[1].set_ylabel("Robustness (a.u.)")
    axes[1].set_title("Robustness check")

    finalize_figure(fig)
    add_panel_labels(fig, axes=list(axes), style="nature")
    require_matplotlib_panel_alignment(fig)
    return fig


def export_example(fig, output):
    fig.savefig(f"{output}.svg", bbox_inches="tight")
    fig.savefig(f"{output}.pdf", bbox_inches="tight")
    fig.savefig(f"{output}.tiff", dpi=600, bbox_inches="tight")
