# Harden My Repo Doctor report

> Illustrative report; this file is not an audit of the Harden My Repo Doctor repository.

**Score:** 76/100 — **Solid**

Target: `example-repository`  
Generated: 2026-07-16T12:00:00.000Z

## Category scores

| Category | Score |
|---|---:|
| Agent instructions | 20/20 |
| Verification commands | 20/20 |
| Agent settings and hooks | 10/15 |
| Secret hygiene signals | 11/15 |
| Context scope | 10/15 |
| Continuous integration | 5/15 |

## Evidence

| Result | Check | Evidence |
|---|---|---|
| Pass | Root agent instructions (12/12) | AGENTS.md |
| Pass | Runnable test command (8/8) | Detected test configuration (test). |
| Pass | Environment files ignored (5/5) | `.gitignore` contains an environment-file pattern. |
| Gap | Reusable hooks, commands, skills, or agents (0/5) | No recognized hooks, commands, skills, or agent files found. |
| Gap | CI runs tests (0/5) | No recognized test command appears in CI workflow text. |

## Suggested next steps

1. **Reusable hooks, commands, skills, or agents:** Package repeated workflows only when they are stable enough to test and maintain.
2. **CI runs tests:** Run the canonical test command in CI.

## Scope and limitations

Static, network-free review of filenames and selected repository text/configuration. Project code is not executed. Results do not prove security, permission enforcement, or the absence of secrets.

Optional: [free Harden My Repo audit](https://hardenmyrepo.com/free-ai-repo-audit).
