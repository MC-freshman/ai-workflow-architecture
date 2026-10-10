"""D-75 machine check: the validate_contracts.py copy living in the pinned scanner release must be
byte-identical to the one in the pinned contracts package. 3.1-A registered that a fix applied to
one copy left the other stale; this test makes that state fail loudly instead of silently."""
import hashlib
import unittest
from pathlib import Path

from . import env_config


def _sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class ValidatorSync(unittest.TestCase):
    def test_scanner_and_contracts_validators_are_byte_identical(self):
        config = env_config.load()
        scanner_release = Path(config["scannerRelease"])
        contracts_release = Path(config["contracts"])
        a = scanner_release / "contracts" / "runtime" / "validate_contracts.py"
        b = contracts_release / "contracts" / "runtime" / "validate_contracts.py"
        if not a.is_file():
            self.skipTest("scanner release carries no validate_contracts.py (pre-3.1 layout)")
        self.assertTrue(b.is_file(), "contracts package carries no validate_contracts.py")
        self.assertEqual(
            _sha(a), _sha(b),
            "D-75: validate_contracts.py differs between the pinned scanner release (%s) and the "
            "pinned contracts package (%s) - a fix landed in one copy only" % (scanner_release, contracts_release))


if __name__ == "__main__":
    unittest.main(verbosity=2)
