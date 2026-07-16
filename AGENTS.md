# Repository instructions

This repository contains a dependency-free Node.js CLI and GitHub Action. Keep runtime code in `src/`, tests in `test/`, and action metadata at the repository root.

## Verification

Run both commands before considering a change complete:

```bash
make test
make check
```

The CLI must remain network-free and must never execute code from the repository being inspected. Do not add secret-content claims based only on filenames or regex matches. Keep report writes explicit and documented.

