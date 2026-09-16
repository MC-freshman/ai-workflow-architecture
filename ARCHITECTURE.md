# Architecture 1.0.0

## Layers

```text
User message: /wf or /wfa
             │
Platform adapter: parse · resolve · lock · run · gate · record
             │
Shared repository: immutable tool/ and agent/ releases
             │
Platform runtime: isolated runs/<run-id>/ state and outputs
```

The shared repository is declarative and read-only during a run. A platform may select its own adapter implementation, but it may not rewrite another platform's state or silently change shared defaults.

## Invariants

1. `tool/` stores Workflows; `agent/` stores Agents.
2. Published `versions/<semver>/` directories are immutable.
3. Every release has a `SHA256SUMS` file covering its payload.
4. `current.json` is the only shared-default pointer.
5. An Agent selects its Workflow through an exact `tool-lock.json`; callers cannot override it.
6. Each run records resolved versions and sources in a platform-owned `run-lock.json` before execution.
7. Different runs use different directories and can execute concurrently.
8. A resource that requires an unsupported capability must fail closed, not degrade silently.

## Resolution

For `/wf <id>`, read `tool/registry.json`, then the resource's `current.json`, unless a platform-local exact version was explicitly configured. For `/wfa <id>`, resolve the Agent first, then resolve the exact Workflow declared in its `tool-lock.json`. Platform-local defaults may not override an Agent lock.

## Updating a default

Create and validate a new version directory first. Switching a default changes the pointer only after acceptance succeeds. Existing runs remain reproducible because their run locks retain the old exact versions.

## Concurrency

Shared release bytes are read-only. Mutable state belongs under `runtime/runs/<run-id>`. Same-resource and different-resource runs can therefore proceed in parallel. If two runs target the same external project directory, the platform adapter must serialize that project explicitly and document the limitation.

