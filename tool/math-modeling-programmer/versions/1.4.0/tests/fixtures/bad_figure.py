import matplotlib as mpl
import matplotlib.pyplot as plt


mpl.rcParams.update({
    "font.family": "sans-serif",
    "font.sans-serif": ["Arial", "DejaVu Sans"],
    "font.size": 7,
    "svg.fonttype": "none",
    "pdf.fonttype": 42,
})


def build_figure():
    fig, ax = plt.subplots(figsize=(7.2, 3.2))
    x = list(range(12))
    ax.plot(x, [1.0 + value * 0.02 for value in x], linewidth=2.0, label="Method X")
    ax.set_xticks(x)
    ax.set_xticklabels([f"非常冗长的条件标签-{value}-实验组" for value in x])
    ax.set_xlabel("Condition with a deliberately long axis label")
    ax.set_ylabel("Score (a.u.)")
    ax.set_title("A deliberately overlong title that requires layout correction")
    ax.legend(loc="center", frameon=False)
    for value in (3, 4, 5):
        ax.annotate("overlap", (value, 1.0 + value * 0.02), xytext=(0, 0), textcoords="offset points")
    return fig

