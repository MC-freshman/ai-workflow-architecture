"""Shared env resolution for conformance tests. A platform runs this suite by
exporting PCONF_CONFIG (its runner config json). No hardcoded platform root.
"""
import json
import os
from pathlib import Path


def config_path():
    p = os.environ.get("PCONF_CONFIG")
    if not p:
        raise RuntimeError("set PCONF_CONFIG to the platform runner config json path")
    return Path(p)


def load():
    return json.loads(config_path().read_text(encoding="utf-8-sig"))
