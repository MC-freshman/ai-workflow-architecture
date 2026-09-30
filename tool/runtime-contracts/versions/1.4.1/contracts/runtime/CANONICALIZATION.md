# Canonical JSON & hash (contract norm)

Single normative statement of what the copied `validate_contracts.py` (`canonical_bytes`/`digest`/`strict_loads`) enforces, so runner and every platform agree byte-for-byte.

- Algorithm id: `sha256-cjson-safe-v1`.
- Encoding: UTF-8, `ensure_ascii=false`, `sort_keys=true`, separators `(",",":")`, `allow_nan=false`.
- Forbidden in any hashed document: floats, NaN/Infinity, non-string object keys, duplicate keys (`strict_loads` rejects), raw lone surrogates, integers outside ±(2^53−1)=9007199254740991.
- `digest(x) = sha256(canonical_bytes(x)).hexdigest()`.
- Content-addressing: a resource `manifestSha256` hashes its SHA256SUMS manifest; `contentManifestSha256` hashes the file set; both are separate from per-file `sha256`.
- Test vectors (must reproduce, from `validate_contracts.py` main):
  - `{"z":1,"a":[true,null,"x"]}` → `{"a":[true,null,"x"],"z":1}`
  - `{"é":"中","a":-0}` → `{"a":0,"é":"中"}`
  - `{"x":"\n\t\"\\"}` → `{"x":"\n\t\"\\"}` (escaped)
  - reject: `1.5`, `NaN`, lone surrogate `\ud800`, `9007199254740992`
  - strict-json reject: `{"x":1,"x":2}` (dup), `{"x":1e2}` (float), `{"x":NaN}`, BOM prefix.

Hashes prove *content equality to a manifest only*. They do not prove publisher identity, ACL, or business correctness. Access-rights, source-trust, and file-set-integrity are separate checks.
