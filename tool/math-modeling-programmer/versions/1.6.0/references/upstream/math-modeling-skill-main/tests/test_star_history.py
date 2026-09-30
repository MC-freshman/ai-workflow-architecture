import json
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "update_star_history.py"


class StarHistoryTests(unittest.TestCase):
    def test_generates_16_9_svg_with_50_star_ticks_and_headroom(self):
        with tempfile.TemporaryDirectory() as directory:
            history = Path(directory) / "history.json"
            output = Path(directory) / "star-history.svg"
            history.write_text(
                json.dumps([{"date": "2026-07-31", "count": 548}]),
                encoding="utf-8",
            )

            subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--count",
                    "558",
                    "--date",
                    "2026-08-01",
                    "--history",
                    str(history),
                    "--output",
                    str(output),
                ],
                check=True,
            )

            svg = output.read_text(encoding="utf-8")
            points = json.loads(history.read_text(encoding="utf-8"))
            ET.parse(output)
            self.assertIn('viewBox="0 0 960 540"', svg)
            self.assertIn('data-y-max="650"', svg)
            self.assertEqual(svg.count("data-y-tick"), 14)
            self.assertEqual(points[-1], {"date": "2026-08-01", "count": 558})


if __name__ == "__main__":
    unittest.main()
