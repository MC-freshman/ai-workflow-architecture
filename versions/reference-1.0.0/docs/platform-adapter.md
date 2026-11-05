# Platform adapter contract

Every platform adapter implements these responsibilities:

1. **parse** — accept `/wf <workflow-id> <task>` and `/wfa <agent-id> <task>`;
2. **discover** — read enabled resources from the shared registries;
3. **resolve** — select an exact resource version from a pointer or platform-local default;
4. **close dependencies** — for Agents, honor the exact `tool-lock.json` and reject caller overrides;
5. **lock** — write exact resource, schema, dependency, and source information before execution;
6. **isolate** — allocate a unique platform-owned run directory and never write into another platform;
7. **gate** — fail closed when schemas, hashes, dependencies, or required capabilities are missing;
8. **record** — retain inputs, state transitions, outputs, and the final status for audit and recovery.

A platform is connected only after its invocation matrix contains no unexpected failures and it has demonstrated both `/wf` and `/wfa` paths.

