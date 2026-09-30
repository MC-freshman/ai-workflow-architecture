# Model Skill Backup Import Report

Import snapshot: `snapshot-2026.08.31`

The source tree `E:\ModelSkillBackup` was treated as read-only. The importer
copied source bytes and recorded SHA-256 hashes; it did not edit, delete, or
generate files in the source tree.

## Published inventory

| Area | Published result |
| --- | --- |
| GameForge | 34 source Skills, 20 Workflows, `game-core` pack, three mutually exclusive engine packs |
| Novel Skills Hub | Hub Markdown normalized as Skills; `novel-writing` pack selects story/Chinese writing entries only |
| Programming | 1,775 total normalized entries across Awesome Coding, ECC, Matt Pocock, and related sources; only a curated 11-Skill `software-engineering` pack is Agent-default |
| Paper and modeling | Source snapshots plus figure-related Skills; `math-modeling-programmer` upgraded from `1.1.0` to `1.4.0` with visual QA locks |
| Web security | Immutable archive snapshot retained; no duplicate public Skill IDs created because it overlaps the existing `mastermind-*` family |

## Active Agent releases

- `game-builder@1.3.0`: game role Skills and game production Workflows at `2.0.1`. An engine Profile is required and Godot/Unity/Unreal are mutually exclusive.
- `novel-writer@1.1.0`: story and Chinese writing Skills only.
- `software-engineer@1.1.0`: requirement, discipline, implementation, testing, API, frontend, documentation, CI/CD, and security review Skills.
- `visualization-engineer@1.4.0`: `visualization-layout@1.1.0`, figure QA Skills, and executable `visualization-qa@1.1.0`.
- `security-researcher@1.1.0`: explicitly authorized, read-only-by-default audit Skills.
- `math-modeling-programmer@1.5.0`: modeling workflow `1.4.0` plus the visual renderer/layout QA lock; `1.1.0` remains available for rollback.

## Visualization quality gate

`visualization-qa` requires actual runtime rendering, element-bound measurement,
clipping/overlap checks, deterministic repair, and a second render. Missing
geometry evidence produces `REVIEW_REQUIRED`; the Agent cannot claim that a
figure passed based on source code alone.

## Licensing and source notes

Source snapshots retain their upstream `LICENSE` files where present. The user
confirmed open-source authorization for the imported backup; sources without a
visible license file are marked `user-confirmed-open-source` in `SOURCE.json`
and should be rechecked if redistributed outside this workspace.

The workspace documents remain authoritative and were not imported as Skills:

- `E:\ai\AGENTS.md` controls workspace operations.
- `E:\ai\AI_ARCHITECTURE_SYSTEM_PROMPT.md` controls isolation, versioning, locks, and rollback.
- `E:\ai\tool\README.md` documents the shared registry.

Source-local `AGENTS.md`, `CLAUDE.md`, and README files stay inside the immutable
source snapshots and do not override the workspace rules.

## Verification

- Registry validator: passed (`8 Skill catalog shards / 1,775 indexed entries`, `8 Packs`, `23 Workflows`, `13 Agents`).
- Published release files: new releases have `SHA256SUMS` and are read-only.
- Hash verification: `20,783` entries checked against the Tool Hub two-space format, `0` mismatches.
- Backup comparison: `5,154` source files compared with snapshots, `0` mismatches.
- Visual QA demo: detected deliberate long-title clipping and tick-label overlap and produced a PNG preview under the Codex runtime.
