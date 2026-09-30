# architecture-ops 1.4.0

`kind = governance-tool`, `invocable = false`. Shared, versioned governance (extracts the
generic logic previously stranded in one platform's workspace — F10). Platforms keep a thin
adapter and pass their own `--config`. `switch_defaults` writes only the calling platform's
bridge; `switch_current` changes one explicitly selected shared `current.json` and keeps its
exact rollback bytes under the calling platform's runtime. Neither command writes another
platform's state.

- `switch_defaults` — requirement #3 one-sentence default switch. `plan → apply(CAS + checkpoint) → verify → revert`.
  Edits **only** the invoking platform's `bridge.json` `defaults.{workflow|agent}Versions`.
  Blocks on CAS drift or an unpublished/target-integrity failure; byte-exact `revert`.
- `switch_current` — D-31 shared pointer switch. It supports `workflow`, `agent`, `software`,
  `contracts`, and `governance`; checks registry membership, target manifest identity, and
  two-way `SHA256SUMS` coverage; then performs `plan → apply(CAS + exact-byte checkpoint) →
  verify → revert`. The checkpoint must be under the calling platform's
  `runtime/maintenance/` directory. It switches one pointer at a time and makes no claim about
  cross-platform arbitration.
- `version_impact` — read-only reverse dependency: which agents exact-tool-lock `id@version`,
  so a switch is checked for closure before apply (a changed pin needs a paired agent release).

Contract note: `doctor` is standardized as a per-platform read-only command (zcode ships one
under its `ops/`); this package owns the switch/impact logic shared across platforms.

Example for switching one shared pointer after the rollback commit exists:

```powershell
python -B -m architecture_ops.switch_current plan `
  --config <platform-runner-config> --kind workflow --id repo-lint `
  --from 0.5.1 --to 0.5.2 --checkpoint <platform-runtime>/maintenance/<change-id>
python -B -m architecture_ops.switch_current apply --plan <plan.json>
python -B -m architecture_ops.switch_current verify --plan <plan.json>
python -B -m architecture_ops.switch_current revert --plan <plan.json>
```

`plan` writes the original pointer bytes before any shared write. `apply` refuses if the
registry entry, target release, or pointer changed after planning. `revert` restores the saved
pointer only while it still matches this plan's applied bytes. The command does not create a
Git commit; follow BP-6 and commit the rollback point before applying a shared pointer change.

- `invocation_matrix` (1.1.0) - the acceptance judge itself, now shared and versioned (D-10). Before this
  release every platform kept its own copy under `bridge/ops/`, copies drifted silently, and the packaged
  defaults pointed at a *different* platform's config and exception ledger. There are no platform defaults
  here: pass `--config` (required, the calling platform's own runner config), optionally `--exceptions`, and
  `--out` (parent directories are created for you). Run identifiers carry a per-invocation stamp, so
  re-running the matrix never collides with a previous run directory. `--print-digest` prints the digest of
  this module from the release's own `SHA256SUMS` so a platform can pin which judge it was measured by.

Release discipline (D-24): this directory ships `SOURCE.json`; 1.0.0 does not and that gap stays on record
as historical, because published releases are never rewritten.

## 1.4.0 (D-31)

Adds the checkpointed `switch_current` command for one shared pointer, with registry and release
integrity validation, compare-and-swap, calling-platform checkpoint placement, readback, and
guarded byte-exact revert. It does not change the shared pointer by being published.

## 1.2.0 (staged at 3.0 S-P2, not published)

`switch_defaults --kind` accepts `workflow|agent|software`. The root the target release is verified under is `toolRoot`, `agentRoot` or `softwareRoot` from the platform config, so the same plan/apply/verify/revert sequence, the same CAS on the prior bridge hash and the same byte-exact revert cover all three shared repositories. The command still writes only the platform bridge it is pointed at: no shared `current.json`, no other platform.
