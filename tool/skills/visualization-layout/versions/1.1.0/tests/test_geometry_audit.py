import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))

from geometry_audit import audit_geometry


def test_detects_legend_and_subplot_overlap():
    result = audit_geometry({
        "canvas": {"width": 800, "height": 600},
        "elements": [
            {"id": "subplot-a", "type": "subplot", "x": 50, "y": 50, "width": 300, "height": 200},
            {"id": "legend", "type": "legend", "x": 250, "y": 120, "width": 180, "height": 80},
        ],
    })
    assert result["verdict"] == "FAIL"
    assert any(issue["code"] == "overlap" for issue in result["issues"])


def test_passes_separated_elements():
    result = audit_geometry({
        "canvas": {"width": 800, "height": 600},
        "elements": [
            {"id": "subplot-a", "type": "subplot", "x": 50, "y": 50, "width": 300, "height": 200},
            {"id": "legend", "type": "legend", "x": 500, "y": 50, "width": 220, "height": 80},
        ],
    })
    assert result["verdict"] == "PASS"
