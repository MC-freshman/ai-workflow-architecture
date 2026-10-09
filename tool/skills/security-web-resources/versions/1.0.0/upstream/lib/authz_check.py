"""Authorization gate for active-scan skills.

Per AT-ADEC 685 scope decision: every penetration-tester v3 skill that issues
network requests against a target the user does NOT obviously own (i.e., not
localhost / 127.0.0.1 / RFC1918 / the user's own GitHub-resolved repo path)
MUST gate behind explicit attestation before running the scan.

The attestation pattern is a two-step gate:

  1. The skill's SKILL.md instructs Claude to ask the user verbatim:
     "Do you have authorization to perform security testing on this target?
      I need confirmation before proceeding."

  2. The skill's script accepts --authorized as a required flag for
     non-local targets. The flag MUST be set explicitly; there is no env-var
     fallback (which would let CI silently scan anything).

This module exposes the helper that distinguishes "obviously local / owned"
from "everything else" so each skill can apply the gate consistently.

References:
    - OWASP WSTG v4.2 § 2.1 "Set the scope, define rules of engagement"
    - Penetration Testing Execution Standard (PTES) § Pre-engagement Interactions
    - NIST SP 800-115 § 5.1 "Planning"
"""

from __future__ import annotations

import ipaddress
import sys
import urllib.parse


_RFC1918_NETS = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
]
_LOOPBACK_NETS = [
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("::1/128"),
]


def is_obviously_local(target: str) -> bool:
    """True if target is a loopback / link-local / RFC1918 URL or path.

    Used to short-circuit the authz gate for targets the user obviously owns.
    Errs on the side of REQUIRING attestation: any ambiguity → False → gate
    fires.
    """
    parsed = urllib.parse.urlparse(target)
    host = parsed.hostname

    if not host:
        # Treat empty / unparseable as non-local — force the gate.
        return False

    if host in ("localhost", "localhost.localdomain"):
        return True

    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        # Hostname — not an IP. Not provably local.
        return False

    if any(ip in net for net in _LOOPBACK_NETS):
        return True
    if any(ip in net for net in _RFC1918_NETS):
        return True
    if ip.is_link_local:
        return True
    return False


def require_authorization(target: str, authorized_flag: bool) -> None:
    """Every active target, including private networks, requires a current scope receipt."""
    import os, json, datetime
    scope_path=os.environ.get('AI_SECURITY_SCOPE_FILE')
    if not authorized_flag or not scope_path:
        sys.stderr.write('Authorization refused: explicit flag and scoped user authorization receipt required\n')
        raise SystemExit(2)
    try:
        scope=json.loads(open(scope_path,encoding='utf-8').read())
        expires=datetime.datetime.fromisoformat(scope['expiresAt'].replace('Z','+00:00'))
        valid=bool(scope.get('authorizedBy')) and target in scope['targets'] and 'active-test' in scope['allowedActions'] and expires>datetime.datetime.now(datetime.timezone.utc)
    except (OSError,ValueError,TypeError,KeyError):valid=False
    if not valid:
        sys.stderr.write('Authorization refused: target/action/window outside receipt\n')
        raise SystemExit(2)
