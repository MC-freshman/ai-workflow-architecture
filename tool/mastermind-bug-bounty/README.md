# Mastermind Bug Bounty Workflow

Versioned shared workflow for authorized security analysis.

- Current pointer: `current.json`
- Immutable release: `versions/1.0.0`
- Stages: discovery, analysis, triage and reporting.
- Discovery and analysis workers may run in parallel; triage and reporting depend on prior summaries.
- The DSH bridge resolves this workflow once per run and writes the run lock under `E:\ai\dsh\runtime`.
- This release contains schemas and orchestration metadata only; platform runtime owns credentials, sessions and output.
