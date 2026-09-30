#!/usr/bin/env python3
"""Restricted stdio MCP server for the math-modeling-programmer skill.

This is a dependency-free JSON-RPC implementation for local use. It intentionally
exposes project-scoped tools instead of an arbitrary shell command tool.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any


VERSION = "1.5.0"
STAGES = ["INIT", "AUDIT", "SPEC", "BASELINE", "SOLVE", "EXPERIMENT", "VALIDATE", "FIGURES", "FREEZE"]


def text_result(payload: Any, *, is_error: bool = False) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False, indent=2)}], "isError": is_error}


class RestrictedServer:
    def __init__(self, project: Path):
        self.project = project.resolve()
        self.scripts = (Path(__file__).resolve().parent)

    def relative(self, value: str, *, must_exist: bool = False) -> Path:
        if not value or Path(value).is_absolute():
            raise ValueError("工具参数必须是项目内相对路径")
        path = (self.project / value).resolve()
        if self.project not in path.parents and path != self.project:
            raise ValueError("路径越出项目根目录")
        if must_exist and not path.exists():
            raise FileNotFoundError(value)
        return path

    def run_script(self, script: str, arguments: list[str], timeout: float = 300) -> dict[str, Any]:
        if script not in {"init_project.py", "audit_data.py", "run_experiments.py", "run_tasks.py", "review_task.py", "run_validations.py", "register_result.py", "register_figure.py", "check_figures.py", "check_pdf.py", "freeze_artifacts.py", "stage_machine.py", "check_lineage.py", "record_environment.py", "project_doctor.py", "run_figure_qa.py", "record_visual_review.py"}:
            raise ValueError("脚本不在 MCP 允许列表中")
        completed = subprocess.run([sys.executable, str(self.scripts / script), *arguments], cwd=self.project,
                                   text=True, encoding="utf-8", errors="replace",
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   timeout=min(max(float(timeout), 1), 3600), check=False)
        lines = [line for line in completed.stdout.splitlines() if line.strip()]
        parsed: Any = lines[-1] if lines else ""
        if completed.stdout.strip():
            try:
                parsed = json.loads(completed.stdout.strip())
            except json.JSONDecodeError:
                if lines:
                    try:
                        parsed = json.loads(lines[-1])
                    except json.JSONDecodeError:
                        pass
        return {"returncode": completed.returncode, "stdout": parsed, "stderr": completed.stderr[-4000:]}

    def tools(self) -> list[dict[str, Any]]:
        path_schema = {"type": "string", "description": "项目内相对路径"}
        return [
            {"name": "project_init", "description": "初始化项目目录和阶段状态", "inputSchema": {"type": "object", "properties": {"project_id": {"type": "string"}, "language": {"type": "string"}, "entrypoint": {"type": "string"}}}},
            {"name": "project_doctor", "description": "检查项目结构和阶段就绪状态", "inputSchema": {"type": "object", "properties": {}}},
            {"name": "inspect_dataset", "description": "审计 CSV、TSV 或 JSON 数据", "inputSchema": {"type": "object", "required": ["input"], "properties": {"input": path_schema}}},
            {"name": "run_experiment", "description": "使用项目配置运行实验矩阵", "inputSchema": {"type": "object", "required": ["config"], "properties": {"config": path_schema, "output_dir": path_schema, "timeout": {"type": "number"}}}},
            {"name": "run_task_batch", "description": "按任务清单批量执行零散建模任务", "inputSchema": {"type": "object", "required": ["manifest"], "properties": {"manifest": path_schema, "mode": {"type": "string", "enum": ["quick", "official", "debug"]}, "task_ids": {"type": "array", "items": {"type": "string"}}, "timeout": {"type": "number"}, "no_cache": {"type": "boolean"}, "stop_on_error": {"type": "boolean"}}}},
            {"name": "task_status", "description": "读取任务登记表中每个任务的最新状态", "inputSchema": {"type": "object", "properties": {"registry": path_schema}}},
            {"name": "review_task", "description": "记录建模手对任务产物的审核结论", "inputSchema": {"type": "object", "required": ["task_id", "decision"], "properties": {"task_id": {"type": "string"}, "decision": {"type": "string", "enum": ["ACCEPTED", "REWORK", "BLOCKED"]}, "notes": {"type": "string"}, "registry": path_schema}}},
            {"name": "validate_experiment", "description": "运行声明式验证插件", "inputSchema": {"type": "object", "required": ["config"], "properties": {"config": path_schema, "output": path_schema}}},
            {"name": "check_figures", "description": "检查登记图表和文件质量", "inputSchema": {"type": "object", "properties": {"registry": path_schema, "output": path_schema}}},
            {"name": "figure_qa", "description": "渲染图表并执行布局、面板对齐和 PDF 几何 QA", "inputSchema": {"type": "object", "required": ["source", "contract", "output_dir"], "properties": {"source": path_schema, "contract": path_schema, "output_dir": path_schema, "pdf": path_schema, "iteration": {"type": "string"}, "strict": {"type": "boolean"}, "timeout": {"type": "number"}}}},
            {"name": "record_visual_review", "description": "记录 PNG 视觉复核证据并绑定 QA 哈希", "inputSchema": {"type": "object", "required": ["preview", "qa_report", "output", "decision", "reviewer_type", "reviewer"], "properties": {"preview": path_schema, "qa_report": path_schema, "output": path_schema, "decision": {"type": "string", "enum": ["PASS", "REWORK", "BLOCKED"]}, "reviewer_type": {"type": "string", "enum": ["human", "multimodal-agent"]}, "reviewer": {"type": "string"}, "checks": {"type": "array", "items": {"type": "string"}}, "observations": {"type": "array", "items": {"type": "string"}}}}},
            {"name": "check_pdf", "description": "检查 PDF 文件和编译日志", "inputSchema": {"type": "object", "required": ["pdf"], "properties": {"pdf": path_schema, "log": path_schema, "output": path_schema}}},
            {"name": "check_lineage", "description": "检查结果登记的输入、代码和配置哈希", "inputSchema": {"type": "object", "properties": {"registry": path_schema}}},
            {"name": "freeze_project", "description": "生成项目交付哈希清单", "inputSchema": {"type": "object", "properties": {"output": path_schema}}},
            {"name": "stage_status", "description": "读取当前阶段状态", "inputSchema": {"type": "object", "properties": {}}}
        ]

    def call(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        if name == "project_init":
            command = ["--project-id", str(arguments.get("project_id", self.project.name)), "--language", str(arguments.get("language", "python")), "--entrypoint", str(arguments.get("entrypoint", "src/main.py"))]
            return text_result(self.run_script("init_project.py", [".", *command]))
        if name == "project_doctor":
            return text_result(self.run_script("project_doctor.py", ["."]))
        if name == "inspect_dataset":
            input_path = self.relative(str(arguments["input"]), must_exist=True)
            return text_result(self.run_script("audit_data.py", [str(input_path), "--output-dir", "reports/mcp_audit"]))
        if name == "run_experiment":
            config = self.relative(str(arguments["config"]), must_exist=True)
            output_dir = str(arguments.get("output_dir", "experiments"))
            self.relative(output_dir)
            return text_result(self.run_script("run_experiments.py", [str(config), "--project", str(self.project), "--output-dir", output_dir, "--timeout", str(arguments.get("timeout", 3600))], timeout=float(arguments.get("timeout", 3600)) + 10))
        if name == "run_task_batch":
            manifest = self.relative(str(arguments["manifest"]), must_exist=True)
            command = [str(manifest), "--project", str(self.project), "--mode", str(arguments.get("mode", "quick")), "--timeout", str(arguments.get("timeout", 3600))]
            for task_id in arguments.get("task_ids", []) or []:
                command += ["--task", str(task_id)]
            if arguments.get("no_cache"):
                command.append("--no-cache")
            if arguments.get("stop_on_error"):
                command.append("--stop-on-error")
            return text_result(self.run_script("run_tasks.py", command, timeout=float(arguments.get("timeout", 3600)) + 10))
        if name == "task_status":
            registry = str(arguments.get("registry", "tasks/task_registry.jsonl"))
            self.relative(registry)
            return text_result(self.run_script("run_tasks.py", ["tasks/manifests/example.json", "--project", str(self.project), "--status", "--registry", registry]))
        if name == "review_task":
            registry = str(arguments.get("registry", "tasks/task_registry.jsonl"))
            self.relative(registry)
            command = ["--project", str(self.project), "--task-id", str(arguments["task_id"]), "--decision", str(arguments["decision"]), "--registry", registry]
            if arguments.get("notes"):
                command += ["--notes", str(arguments["notes"])]
            return text_result(self.run_script("review_task.py", command))
        if name == "validate_experiment":
            config = self.relative(str(arguments["config"]), must_exist=True)
            output = str(arguments.get("output", "reports/validation.json"))
            self.relative(output)
            return text_result(self.run_script("run_validations.py", [str(config), "--project", str(self.project), "--output", output]))
        if name == "check_figures":
            registry = str(arguments.get("registry", "figures/figure_registry.csv"))
            self.relative(registry, must_exist=True)
            output = str(arguments.get("output", "reports/figure_check.json"))
            self.relative(output)
            return text_result(self.run_script("check_figures.py", ["--project", str(self.project), "--registry", registry, "--output", output]))
        if name == "figure_qa":
            source = self.relative(str(arguments["source"]), must_exist=True)
            contract = self.relative(str(arguments["contract"]), must_exist=True)
            output_dir = str(arguments["output_dir"])
            self.relative(output_dir)
            command = ["--project", str(self.project), "--source", str(source.relative_to(self.project)), "--contract", str(contract.relative_to(self.project)), "--output-dir", output_dir, "--iteration", str(arguments.get("iteration", "01"))]
            if arguments.get("pdf"):
                pdf = self.relative(str(arguments["pdf"]), must_exist=True)
                command += ["--pdf", str(pdf.relative_to(self.project))]
            if arguments.get("strict"):
                command.append("--strict")
            timeout = float(arguments.get("timeout", 300))
            return text_result(self.run_script("run_figure_qa.py", command, timeout=timeout + 10))
        if name == "record_visual_review":
            preview = self.relative(str(arguments["preview"]), must_exist=True)
            qa_report = self.relative(str(arguments["qa_report"]), must_exist=True)
            output = str(arguments["output"])
            self.relative(output)
            command = ["--project", str(self.project), "--preview", str(preview.relative_to(self.project)), "--qa-report", str(qa_report.relative_to(self.project)), "--output", output, "--decision", str(arguments["decision"]), "--reviewer-type", str(arguments["reviewer_type"]), "--reviewer", str(arguments["reviewer"])]
            for check in arguments.get("checks", []) or []:
                command += ["--check", str(check)]
            for observation in arguments.get("observations", []) or []:
                command += ["--observation", str(observation)]
            return text_result(self.run_script("record_visual_review.py", command))
        if name == "check_pdf":
            pdf = self.relative(str(arguments["pdf"]), must_exist=True)
            command = [str(pdf)]
            if arguments.get("log"):
                command += ["--log", str(self.relative(str(arguments["log"]), must_exist=True))]
            if arguments.get("output"):
                output = str(arguments["output"])
                self.relative(output)
                command += ["--output", output]
            return text_result(self.run_script("check_pdf.py", command))
        if name == "check_lineage":
            registry = str(arguments.get("registry", "results/result_registry.jsonl"))
            self.relative(registry, must_exist=True)
            return text_result(self.run_script("check_lineage.py", ["--project", str(self.project), "--registry", registry]))
        if name == "freeze_project":
            output = str(arguments.get("output", "results/manifest.sha256"))
            output_path = self.relative(output)
            return text_result(self.run_script("freeze_artifacts.py", [str(self.project), "--output", str(output_path)]))
        if name == "stage_status":
            return text_result(self.run_script("stage_machine.py", ["status", "--project", str(self.project)]))
        raise ValueError(f"未知工具: {name}")

    def handle(self, message: dict[str, Any]) -> dict[str, Any] | None:
        method = message.get("method")
        request_id = message.get("id")
        if method == "notifications/initialized":
            return None
        if method == "ping":
            return {"jsonrpc": "2.0", "id": request_id, "result": {}}
        if method == "initialize":
            return {"jsonrpc": "2.0", "id": request_id, "result": {"protocolVersion": "2025-06-18", "capabilities": {"tools": {}}, "serverInfo": {"name": "math-modeling-programmer", "version": VERSION}}}
        if method == "tools/list":
            return {"jsonrpc": "2.0", "id": request_id, "result": {"tools": self.tools()}}
        if method == "tools/call":
            params = message.get("params", {})
            try:
                result = self.call(str(params.get("name", "")), params.get("arguments", {}) or {})
            except (KeyError, OSError, ValueError, subprocess.SubprocessError) as exc:
                result = text_result({"status": "failed", "error": str(exc)}, is_error=True)
            return {"jsonrpc": "2.0", "id": request_id, "result": result}
        return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32601, "message": f"方法不支持: {method}"}}


def main() -> int:
    parser = argparse.ArgumentParser(description="Restricted math-modeling-programmer MCP server")
    parser.add_argument("--project", type=Path, default=Path("."), help="explicit project root")
    args = parser.parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    server = RestrictedServer(args.project)
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            message = json.loads(line)
            response = server.handle(message)
            if response is not None:
                sys.stdout.write(json.dumps(response, ensure_ascii=False, separators=(",", ":")) + "\n")
                sys.stdout.flush()
        except json.JSONDecodeError as exc:
            response = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": str(exc)}}
            sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
            sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
