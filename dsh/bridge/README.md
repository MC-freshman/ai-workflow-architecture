# DSH Shared Resource Bridge

DSH uses the shared read-only registries:

- E:\ai\agent\registry.json
- E:\ai\tool\registry.json

Write run locks, logs and outputs below E:\ai\dsh\runtime.

Machine-readable bridge settings are in `bridge.json`. Both `workflow` and
`agent-workflow` modes resolve versions from the shared registries and write
run state only below the DSH runtime root.
