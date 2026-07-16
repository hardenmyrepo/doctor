# Harden My Repo Doctor

Harden My Repo Doctor is a small, dependency-free Node.js audit for repositories that use coding agents. It looks for inspectable readiness evidence: repository instructions, canonical verification commands, agent settings and reusable workflows, bounded secret-hygiene signals, context exclusions, and CI coverage.

**Want a zero-install preview?** [Run the browser-only repository audit](https://hardenmyrepo.com/free-ai-repo-audit?utm_source=github&utm_medium=readme&utm_campaign=doctor). It reads bounded configuration evidence locally and never uploads filenames or file contents.

It does not execute project code, access the network, inspect git history, or modify the repository it audits. It writes only the report paths requested on the command line. Its checks are evidence prompts—not a security certification or proof that permissions and secrets are safe.

## What it checks

The score is bounded to 100 points across six categories:

| Category | Points | Examples of evidence |
|---|---:|---|
| Agent instructions | 20 | Root `AGENTS.md` or `CLAUDE.md`, exact verification guidance, explicit constraints |
| Verification commands | 20 | Non-placeholder test and quality/build commands, documented contributor commands |
| Agent settings and hooks | 15 | Inspectable settings, hooks/skills/commands, permission or path boundaries |
| Secret hygiene signals | 15 | `.gitignore`, environment-file patterns, bounded filename review, maintained automation |
| Context scope | 15 | Ignore rules, generated-directory exclusions, concise/scoped instructions |
| Continuous integration | 15 | Workflow presence, test and quality commands, dependency update configuration |

The filename review is deliberately narrow. A flagged filename needs human review; an unflagged tree does not establish that secrets are absent.

## Local CLI

Requires Node.js 20 or newer. No install step or npm package is required.

Run the current GitHub release in one command:

```bash
npm exec --yes --package=github:hardenmyrepo/doctor -- harden-my-repo .
```

Or clone/download the repository and run the source directly:

```bash
node src/cli.mjs /path/to/repository
```

By default this writes `harden-my-repo-report.md` and `harden-my-repo-report.json` in the current directory.

```bash
node src/cli.mjs . \
  --markdown artifacts/readiness.md \
  --json artifacts/readiness.json \
  --fail-below 70
```

Use `--no-markdown` or `--no-json` to suppress either file, and `--quiet` to suppress the terminal summary. Exit codes are:

- `0`: audit completed and met the configured threshold;
- `1`: audit completed below `--fail-below`;
- `2`: invalid arguments or an unreadable target.

## GitHub Action

Pin the action to a released major or commit SHA in production:

```yaml
name: Agent readiness

on:
  pull_request:
  workflow_dispatch:

jobs:
  doctor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - id: doctor
        uses: hardenmyrepo/doctor@v1
        with:
          path: .
          fail-below: "60"
      - uses: actions/upload-artifact@v4
        with:
          name: harden-my-repo-report
          path: |
            ${{ steps.doctor.outputs.markdown-report }}
            ${{ steps.doctor.outputs.json-report }}
```

The action appends the Markdown report to the job summary by default. Set `job-summary: "false"` to disable that. Report files are still created at the configured paths, and their absolute paths, score, and rating are exposed as outputs.

## Scanning boundaries

- Traversal is capped at 10,000 files and skips symlinks plus common generated/vendor directories.
- Text reads are capped at 512 KiB per file.
- Checks inspect filenames and selected text/configuration only.
- Project scripts, hooks, workflows, and application code are never executed.
- No network request or telemetry is present.
- Reports may reveal repository filenames and configuration signals; review them before publishing from a private repository.

See [SAMPLE_REPORT.md](SAMPLE_REPORT.md) for the report shape.

For a deeper local report with HTML, Markdown, JSON, coverage, four operating profiles, and remediation drafts, see the [full report bundle](https://hardenmyrepo.com/#repo-report).

## Testing

```bash
node --test test/*.test.mjs
```

## License

MIT — see [LICENSE](LICENSE).

Security and privacy boundaries are documented in [SECURITY.md](SECURITY.md).
