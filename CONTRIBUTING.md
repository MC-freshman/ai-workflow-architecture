# Contributing

Open an issue before proposing a contract-breaking change. Pull requests must keep the examples dependency-free and pass:

```bash
python scripts/validate.py
python -m unittest discover -s tests -v
```

Do not submit credentials, production run data, private resource releases, generated caches, or third-party material without a compatible license and attribution.

