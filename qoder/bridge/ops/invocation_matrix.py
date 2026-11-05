# -*- coding: utf-8 -*-
"""Thin launcher: the acceptance judge is a shared, versioned asset (D-10, closed in the 2.0-X round).

Before architecture-ops 1.1.0 every platform kept its own copy of this harness under
`bridge/ops/`; the copies drifted silently and two of them disagreed about which digest they
carried. The logic now lives in `<toolRoot>/architecture-ops/versions/<current>/architecture_ops/`.
This file only resolves that pointer and delegates, so every documented call site keeps working
while the judgement itself has one version anchor shared by all platforms (BP-2: same criteria,
byte-for-byte, for everyone).
"""
import json
import pathlib
import runpy

CONFIG = pathlib.Path(__file__).resolve().parents[2] / 'bridge/qoder-config.json'


def shared_release():
    tool = pathlib.Path(json.loads(CONFIG.read_text(encoding='utf-8-sig'))['toolRoot'])
    pointer = json.loads((tool / 'architecture-ops' / 'current.json').read_text(encoding='utf-8-sig'))
    target = (tool / 'architecture-ops' / 'versions' / pointer['version']
              / 'architecture_ops' / 'invocation_matrix.py')
    if not target.is_file():
        raise SystemExit('architecture-ops current points at a missing release: %s' % target)
    return target


runpy.run_path(str(shared_release()), run_name='__main__')
