# sdd-harness

The plugin half of [`agentic-sdd-kit`](../../README.md): the agnostic Spec-Driven
Development harness for Claude Code.

Provides:

- **`agents/sdd-openspec.md`** — the SDD enforcer subagent the workflow drives (propose →
  human gate → implement → verify; never writes production code before an approved spec).
- **`commands/sdd-feature-flow.md`** — `/sdd-feature-flow`: how and when to launch the harness.
- **`skills/sdd-clarify/`** — front-door; ask load-bearing questions before any spec/code.
- **`skills/pre-pr-greptile/`** — run greptile + triage safe fixes before a manual `gh pr create`.
- **`hooks/`** — `sdd_gate` (block code edits before an approved spec), `sdd_nudge`, `test_gate`.
- **`workflows/sdd-feature-flow.mjs`** — the dynamic workflow (the CLI installs it into `~/.claude/workflows/`).

**Requires** the `caveman` plugin (`caveman:cavecrew-*` subagents). **Pairs with** `engram`
(persistent memory + the Persist-decisions step). Install everything via the kit's
`bin/install.mjs`.

> The workflow file lives here as the source of truth, but the Workflow tool loads it from
> `~/.claude/workflows/`. The installer copies it there; re-run the installer to sync after
> updating it.
