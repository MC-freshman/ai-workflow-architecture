# WorkBuddy Shared Resource Bridge

WorkBuddy uses the shared read-only registries:

- E:\ai\agent\registry.json
- E:\ai\tool\registry.json

Write run locks, logs and outputs below E:\ai\workbuddy\runtime.

Machine-readable bridge settings are in `bridge.json`. Both `workflow` and
`agent-workflow` modes resolve versions from the shared registries and write
run state only below the WorkBuddy runtime root.
