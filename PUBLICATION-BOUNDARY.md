# Publication boundary

This is a file export from private governance HEAD `1645b01512c021e5981e34135481626294165f64`. Private Git ancestors are not imported.

Included: governance text, tool/agent/software registries and immutable resources, reviewed platform bridge text, docs-site sources, architecture-manager source and the historical Apache-2.0 reference snapshot.

Excluded: inbox contents, all platform runtime directories, credentials, installed software directories and bytes, environments, caches and generated build output. Installers are separate GitHub Release assets. Non-frozen governance text uses local-path placeholders. Canonical frozen releases retain historical installation references in provenance text; these are not live bindings. Existing public frozen release bytes remain intact; earlier public redactions and canonical/private differences are listed in PUBLIC-RELEASE-PROVENANCE.json. Do not treat those old derivative seals as a new canonical release.

Original third-party LICENSE/NOTICE files and source licenses retain precedence. The reference snapshot keeps Apache-2.0. The former standalone architecture-manager repository carried no separate license; consolidation does not add a new grant for that subtree.

Regenerate from the private source using `architecture-manager/scripts/export-governance-public.mjs <private-root> <empty-staging> <previous-public-checkout>`. Review and make an ordinary public commit; never push private history or force-push.
