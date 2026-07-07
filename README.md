# agentic-sdd-kit

A project- and stack-agnostic **Spec-Driven Development (SDD) harness for Claude Code**.

It packages an OpenSpec feature-lifecycle **dynamic workflow** — route → clarify →
validated spec → **human approval gate** → implement → validate → **forced-greptile
review** → signed PR — plus the agents, skills and hooks that support it, and a CLI
installer that wires up the plugins it depends on (engram, caveman, chrome-devtools-mcp).

Nothing here is tied to a specific company or repo: it auto-detects Python vs JS/TS
tooling, delegates any end-to-end eval to a per-project script, and takes every
environment-specific value (trunk branch, gh account, reviewer) as an argument.

---

## What's inside

```
.claude-plugin/marketplace.json      # Claude Code marketplace manifest
plugins/sdd-harness/                  # the plugin
  ├── agents/sdd-openspec.md          # the SDD enforcer subagent (used by the workflow)
  ├── commands/sdd-feature-flow.md    # /sdd-feature-flow — how to launch the harness
  ├── skills/
  │   ├── sdd-context-intake/         # ingest a ticket/doc/notes → a well-formed feature brief
  │   ├── sdd-clarify/                # front-door: ask load-bearing questions BEFORE the run
  │   ├── sdd-constitution/           # author/update openspec/project.md (the constitution)
  │   ├── sdd-checklist/              # requirements-quality checklist for a change
  │   ├── sdd-verify/                 # surface-aware verify: chrome-devtools (frontend) / Playwright (API)
  │   └── pre-pr-greptile/            # run greptile + triage before a manual gh pr create
  ├── hooks/                          # SDD gate (block code before an approved spec), nudge, test gate
  └── workflows/sdd-feature-flow.mjs  # the dynamic workflow (installed into ~/.claude/workflows/)
bin/install.mjs                       # interactive CLI installer
```

## Requirements

- **Claude Code** with the Workflow tool (`enableWorkflows: true` — the installer sets it).
- **Node ≥ 18** (the workflow + installer are ESM).
- **Python 3** (the SDD gate/nudge/test-gate hooks are Python).
- **OpenSpec CLI** (`npm i -g openspec`) — the workflow authors/validates OpenSpec changes.
- **greptile CLI**, authenticated — the default (forced) reviewer.
- **caveman** plugin — **required**; the workflow uses `caveman:cavecrew-*` subagents.
- **engram** plugin — optional; enables persistent memory + the "save project decisions" step.
- **chrome-devtools-mcp** — optional; browser automation for eval/verification.

## Install

**Just the harness plugin** — one command (uses the built-in `claude` CLI):

```bash
claude plugin marketplace add alejandro-cedeno-10/agentic-sdd-kit
claude plugin install sdd-harness@agentic-sdd-kit
```

**Full setup** — also installs the dependency plugins (caveman *required*, engram,
chrome-devtools-mcp) **per step**, copies the workflow into `~/.claude/workflows/`, and records
a default reviewer. Clone and run the interactive installer:

```bash
git clone https://github.com/alejandro-cedeno-10/agentic-sdd-kit.git
cd agentic-sdd-kit
node bin/install.mjs
```

The installer detects the `claude` CLI and installs each dependency step by step
(`claude plugin marketplace add` + `claude plugin install --scope user`); if the CLI isn't
found it falls back to writing `settings.json` (Claude Code then installs on next start —
non-destructive, backed up first). It also sets `enableWorkflows: true` and checks the OpenSpec
CLI. Flags: `--yes` (defaults), `--dry-run` (show the steps, change nothing). Re-runnable.
Restart Claude Code afterwards.

## Usage

0. **New repo?** Run **`/sdd-constitution`** once to author `openspec/project.md` (the
   non-negotiable principles the flow honors).
1. In a git repo with an `openspec/` directory, state a **large / cross-cutting** feature.
   (Small changes go straight through `/opsx:propose` → `/opsx:apply`.) If your input is a
   ticket / doc / notes rather than a one-liner, run **`/sdd-context-intake`** first to turn it
   into a clean brief.
2. Run **`/sdd-clarify`** — it asks the load-bearing questions up front (the workflow runs in
   the background and **cannot prompt you mid-run**). At the approval gate, **`/sdd-checklist`**
   grades the spec's quality before you sign off.
3. Launch the workflow (the `/sdd-feature-flow` command explains the exact call and args).
4. The run **stops at the human approval gate** and returns the full proposal / design /
   tasks. Review them, then re-launch with `args.specApproved: true` to implement.
5. It ends at a **signed local commit** (and returns the `gh pr create` command; pass
   `autoPr: true` to open the PR itself).

### The phases

| Phase | What it does |
|-------|--------------|
| **Intake** | Routes/refuses: OpenSpec? big enough? Bails small changes to `/opsx`. |
| **Understand** | Parallel investigators map the blast radius → one design brief. |
| **Spec gate** | Authors a `--strict`-validated OpenSpec change. **Clarity gate** bails with questions on load-bearing unknowns. **Human approval gate** returns the spec and stops until you approve. |
| **Analyze** | Spec-Kit's `/analyze` gate: read-only cross-artifact consistency + coverage check (every requirement has a task, no orphans, no contradictions, honors the constitution). Bails on material gaps before any code. |
| **Persist** | Best-effort: saves the design's decisions to engram (skipped if engram absent). |
| **Implement** | One task at a time, floor (tests+lint) after each. Bails `partial` if automatable tasks remain. |
| **Validate** | Floor (unit tests + lint) + `openspec --strict`. Surface validation (frontend/API) is the on-demand `sdd-verify` skill, not an auto-gate. |
| **Review** | greptile (forced default) — bails loudly rather than silently degrading to cavecrew. One bounded fix round. |
| **Ship** | Hard-guards (feature branch, GPG signing), signed commit, push/PR only if `autoPr`. |

### Key args

`goal`, `specApproved`, `prTarget`/`base` (default `develop`), `diffBase` (default
`develop`), `reviewer` (`greptile` | `cavecrew` | `greptile+cavecrew`), `autoPr`,
`ghUser`, `saveDecisions`. See `commands/sdd-feature-flow.md`.

## Design notes

- **The workflow can't ask you anything.** Background agents have no interactive channel;
  the only way it "asks" is to BAIL and return questions for the main loop to relay. That
  is why `sdd-clarify` runs first and why the human approval gate is a bail, not a prompt.
- **Third-party plugins are referenced, never vendored.** engram, caveman and
  chrome-devtools-mcp install from their own marketplaces under their own licenses.
- **Model-tiered:** mechanical steps run on Haiku, code/spec authoring on Sonnet (Spec-gate
  judgment calls at max effort), never Opus.

## License

MIT — see [LICENSE](./LICENSE).
