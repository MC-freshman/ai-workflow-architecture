import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch


SCRIPTS = Path(__file__).resolve().parents[1] / "tools" / "docx" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import accept_changes
import comment


class AcceptChangesTests(unittest.TestCase):
    def test_detects_tracked_changes_in_docx_parts(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "tracked.docx"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr(
                    "word/document.xml",
                    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:ins/></w:document>',
                )
            self.assertTrue(accept_changes.contains_tracked_changes(path))

    def test_timeout_is_failure_and_does_not_publish_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "input.docx"
            output = Path(tmp) / "output.docx"
            with zipfile.ZipFile(source, "w") as archive:
                archive.writestr("word/document.xml", "<document/>")
            with patch.object(accept_changes, "_setup_libreoffice_macro", return_value=True), patch.object(
                accept_changes.subprocess,
                "run",
                side_effect=subprocess.TimeoutExpired(["soffice"], 30),
            ):
                _, message = accept_changes.accept_changes(str(source), str(output))

            self.assertIn("Error", message)
            self.assertFalse(output.exists())


class CommentTests(unittest.TestCase):
    def test_missing_parent_does_not_modify_package(self):
        with tempfile.TemporaryDirectory() as tmp:
            word = Path(tmp) / "word"
            word.mkdir()

            _, message = comment.add_comment(tmp, 2, "回复", parent_id=999)

            self.assertIn("Error", message)
            self.assertFalse((word / "comments.xml").exists())

    def test_comment_text_and_author_are_xml_escaped(self):
        with tempfile.TemporaryDirectory() as tmp:
            word = Path(tmp) / "word"
            word.mkdir()

            _, message = comment.add_comment(tmp, 0, "A & B", author='甲 & "乙"')

            self.assertNotIn("Error", message)
            parsed = comment.defusedxml.minidom.parse(str(word / "comments.xml"))
            node = parsed.getElementsByTagName("w:comment")[0]
            self.assertEqual(node.getAttribute("w:author"), '甲 & "乙"')
            self.assertIn("A & B", node.getElementsByTagName("w:t")[0].firstChild.nodeValue)


if __name__ == "__main__":
    unittest.main()
