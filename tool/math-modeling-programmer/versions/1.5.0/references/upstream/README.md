# Upstream snapshots

This directory contains read-only source snapshots supplied by the user and
copied for provenance. The active workflow uses only selected scripts under
`scripts/`; it does not auto-discover or execute the snapshots.

- `nature-skills-main`: Apache-2.0 source snapshot.
- `math-modeling-skill-main`: user-confirmed open-source source snapshot; retain
  the source directory as supplied because no root license file was present in
  the observed snapshot.

No credentials, sessions, logs, caches, runtime state or generated outputs are
part of the migration. Do not edit these snapshots in place.
