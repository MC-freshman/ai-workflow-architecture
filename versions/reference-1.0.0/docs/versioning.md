# Versioning and defaults

Resources use semantic versions. A published version directory is immutable; fixes always create a new version. A pointer selects the shared default but is not part of a run's identity.

An upgrade transaction is:

1. create a candidate version;
2. validate schemas, hashes, dependencies, and platform capabilities;
3. checkpoint the old pointer;
4. atomically replace `current.json`;
5. run post-switch checks;
6. restore the checkpoint if acceptance fails.

Agent dependency changes require a new Agent version because `tool-lock.json` is part of the Agent release.

