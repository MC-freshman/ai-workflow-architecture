# AI Workflow Architecture

A portable reference architecture for running versioned Workflows and Agents through two stable entry points:

```text
/wf  <workflow-id> <task>
/wfa <agent-id>    <task>
```

The framework owns interfaces, version resolution, locks, run isolation, and validation. Platforms provide adapters; resources remain independent and replaceable.

## What this repository demonstrates

- immutable semantic-version directories plus movable `current.json` defaults;
- the same invocation envelope for every Workflow and every Agent;
- exact Agent-to-Workflow dependency locks;
- one isolated run directory and `run-lock.json` per invocation;
- parallel invocations without shared mutable run state;
- platform adapters that do not require platform-specific fields in resources;
- a one-command default-version switch that never overwrites a release.

This is the public reference edition, not a dump of a production resource repository. It contains one small Workflow and one small Agent so you can understand and reproduce the architecture without private data or third-party skill catalogs.

## Try it

Requires Python 3.10 or newer and no third-party packages.

```bash
python scripts/validate.py
python -m unittest discover -s tests -v
python reference/adapter.py invoke "/wf hello-world write a greeting"
python reference/adapter.py invoke "/wfa reviewer review the greeting"
python scripts/switch_default.py wf hello-world 1.0.0
```

By default runs are written to `.runtime/runs/<run-id>/`. Pass `--runtime-root` to keep each platform's state in its own directory.

## Start your own repository

1. Copy `examples/repository/` as your shared resource repository.
2. Add a new immutable `tool/<id>/versions/<semver>/` or `agent/<id>/versions/<semver>/` directory.
3. Generate that release's `SHA256SUMS`.
4. Register the resource in `tool/registry.json` or `agent/registry.json`.
5. Move only its `current.json` when changing the shared default.
6. Implement the eight adapter responsibilities in [`docs/platform-adapter.md`](docs/platform-adapter.md).
7. Run validation and concurrency tests before treating the platform as connected.

Read the [architecture](ARCHITECTURE.md), [Chinese quick start](docs/quickstart.zh-CN.md), and [publication boundary](PUBLICATION-BOUNDARY.md).

## Status

Reference architecture version: **1.0.0**.

Licensed under Apache-2.0. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
