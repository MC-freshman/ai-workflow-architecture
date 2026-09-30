import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read(relative_path: str) -> str:
    return (ROOT / relative_path).read_text(encoding="utf-8")


class SubagentProtocolTests(unittest.TestCase):
    def test_root_requires_stage_gates(self):
        text = read("SKILL.md")
        self.assertIn("禁止等全流程结束后才首次派发", text)
        self.assertIn("references/Subagent调度.md", text)
        self.assertIn("P2` 通过后进入论文规划", text)
        self.assertIn("W1` 通过后才开始长篇正文", text)
        for gate in ("M1", "P1", "P2", "W1", "W2"):
            self.assertIn(gate, text)

    def test_role_entries_require_independent_review(self):
        roles = {
            "references/roles/建模手/SKILL.md": ("M1",),
            "references/roles/编程手/SKILL.md": ("P1", "P2"),
            "references/roles/论文手/SKILL.md": ("W1", "W2"),
        }
        for path, gates in roles.items():
            text = read(path)
            self.assertIn("独立", text, path)
            self.assertIn("Subagent", text, path)
            for gate in gates:
                self.assertIn(gate, text, path)

    def test_midstage_gates_precede_expensive_work(self):
        programming = read("references/roles/编程手/SKILL.md")
        writing = read("references/roles/论文手/SKILL.md")
        self.assertLess(programming.index("执行 `P1`"), programming.index("绘图前加载"))
        self.assertLess(writing.index("执行 `W1`"), writing.index("按官方结构写完整正文"))

    def test_reviewers_are_read_only_and_evidence_based(self):
        text = read("references/Subagent调度.md")
        for token in ("默认只读", "输入快照", "PASS", "FAIL", "BLOCKED", "实质变化时"):
            self.assertIn(token, text)
        self.assertIn("不要按搜索引擎拆分", text)

    def test_optional_subagents_are_opt_in(self):
        root = read("SKILL.md")
        protocol = read("references/Subagent调度.md")
        writing = read("references/roles/论文手/SKILL.md")
        self.assertIn("默认模式只派发", root)
        self.assertIn("可选协作默认关闭", protocol)
        self.assertIn("只有用户明确启用", protocol)
        self.assertIn("用户已明确启用", writing)
        for task in ("文献与模型族调研", "隔离算法原型", "独立实验批次", "Python/MATLAB 对照实现"):
            self.assertIn(task, protocol)

    def test_single_format_and_missing_subagent_have_explicit_states(self):
        root = read("SKILL.md")
        protocol = read("references/Subagent调度.md")
        writing = read("references/roles/论文手/SKILL.md")
        self.assertIn("受限交付", root)
        self.assertIn("受限交付", protocol)
        self.assertIn("同时生成两种格式时再检查 Word/LaTeX 一致性", protocol)
        self.assertIn("同时生成两种格式时再检查 Word/LaTeX 一致性", writing)


if __name__ == "__main__":
    unittest.main()
