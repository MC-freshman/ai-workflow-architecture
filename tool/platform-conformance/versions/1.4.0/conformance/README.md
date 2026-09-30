# platform-conformance

`kind = governance-tool`, `invocable = false`. Not a business workflow; never in the `/wf` / `/wfa` denominator.

A **runnable** acceptance suite (stdlib `unittest`) that re-checks, per version, the mechanical parts of the four 2.0 hard gates. Each platform runs it against its own config so "已经支持" points at reproducible evidence bound to that version.

## Run (a platform)
```
set PCONF_CONFIG=<platform>/bridge/<runner-config>.json
python -B -m unittest discover -s conformance -t . -p "test_*.py"   # from versions/<v>/
# -t . is required (D-20): without it the top-level directory is the start directory,
# the modules import as "conformance.test_x" from the wrong root and the suite dies on
# relative imports after reporting "3 tests".
```
Tests:
- `test_contracts` — the `runtime-contracts` validator self-checks green standalone (proves F03 decoupling; asserts no `repo_lint` import). (CON-01/02)
- `test_error_envelope` — every CLI failure path returns exactly one JSON envelope, no traceback leak, v2 fields, no fabricated success. (CON-03, ADR-2, gate-1 format)
- `test_entry04` — registry typing is machine-readable; engine/contracts/packs excluded by type, not EXPECTED. (ENTRY-04)
- `test_evidence_bindings` (1.1.0) — every `descriptor.evidenceBindings` digest the platform declares is
  recomputed from the bytes on disk: config file, pinned runner `manifest.json`, pinned runner tree, and the
  sealed environment manifest. A stale declaration fails the suite instead of silently describing a config that
  no longer exists. Rules:
  `configDigest = sha256(config bytes)` · `runnerDigest = sha256(<runner>/manifest.json)` ·
  `runnerTreeDigest = sha256(join(sha256(file) + "  " + relpath, sorted, excluding SHA256SUMS))` ·
  `environmentDigest = sha256(environmentManifest bytes)`. (CON-04, D-11)

## Scope
Covers the statically-checkable gate parts shipped by P1–P2. Business-loop (L2), isolation (L3), C5 concurrency, one-sentence switch/rollback, and full `/wf` repo-lint closure add cases as those phases (P3–P5) land; a missing case is reported as absent, never as PASS.

## Conformance floor (`conform`) — 1.2.0
```
python -B -m conformance.conform --config <platform>/bridge/<runner-config>.json     --out floor.json [--union-out union.json] [--strict]
```
One command, three lists and two digests:

* **union, computed here once** — `action:*`, `permission-triple:<fs>/<net>/<proc>`,
  `python-package:<dist>`, `profile:<name>`, read out of `tool/agent/software` registries and the
  release each pointer selects. No platform config can reach it: two platforms print the same
  `unionSha256`. A repository with no `registry.json` shows up as `unionSourceGaps` (its features
  are unaccounted) rather than as an empty, green list.
* **verdicts for this platform only** — `pass` / `declaredAbsent` / `unverified`, derived from the
  platform's own `capabilities.json` read back against the bytes it names.
* **every non-pass item needs `gapPlan[<id>] = {path, costMinutes}`** — a gap without a way out is a
  claim, not a plan, so it lands in `remediationMissing` and `floorReached` stays false. The
  wording "本平台不支持" is not an accepted path: `path` must say what to change and what it costs.

`floorReached` is the §3.3 completion criterion (0 declaredAbsent, 0 unverified, 0
remediationMissing). This command never declares another platform finished: per BP-2 §2.6 each
platform runs it on its own config and its own bytes.


## 1.3.0 (staged at 3.0 S-P5, not published)

`conform --only <softwareId>`: same report structure, `unionSha256` still computed over the whole
union of the three shared repositories (it is shared-side and platform-independent), and the
*verdict rows* narrowed to what that one release contributes. A filtered set with no rows is never
`floorReached` - an empty denominator does not get to answer "green". Without `--only` the command is
byte-identical in behaviour to 1.2.0.
