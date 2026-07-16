# Security and privacy

Harden My Repo Doctor is a bounded repository-configuration audit, not a security scanner or certification.

## Execution boundary

- Project code, scripts, hooks, workflows, and package-manager commands are never executed.
- The Doctor makes no network requests and includes no telemetry.
- Symlinks are skipped.
- Common dependency, generated, vendor, VCS, and binary paths are skipped.
- Traversal and text reads are capped as documented in the README.
- Output is written only to the requested report paths.

## Report sensitivity

Reports can contain repository filenames and excerpts of configuration evidence. Treat a report from a private repository as private until a human reviews it.

## Reporting a vulnerability

Do not open a public issue containing secrets, private repository content, or an unpatched exploit. Until a dedicated security contact is published, use the support form at:

https://hardenmyrepo.com/support

Include the affected version, reproduction steps using non-sensitive sample data, and the expected versus actual boundary.
