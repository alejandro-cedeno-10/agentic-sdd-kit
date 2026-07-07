---
name: sdd-feature-flow
description: Launch the opt-in sdd-feature-flow dynamic workflow — the OpenSpec feature lifecycle conductor (route → understand → validated spec → human approval gate → implement → validate → forced-greptile review → signed PR). For genuinely large / cross-cutting OpenSpec features only; small changes should use /opsx:propose → /opsx:apply directly.
category: Workflow
tags: [workflow, openspec, sdd]
---

Launch the **sdd-feature-flow** dynamic workflow. The harness script is installed by
`agentic-sdd-kit`'s CLI at `~/.claude/workflows/sdd-feature-flow.mjs` (on Windows,
`%USERPROFILE%\.claude\workflows\sdd-feature-flow.mjs`).

This is an EXPENSIVE, opt-in multi-agent workflow — the Workflow tool's first-run
confirmation is the spend gate. Only launch it for a genuinely large / cross-cutting
OpenSpec feature. For a single-file edit, bugfix, or docs/spec-only change, do NOT
launch it — use `/opsx:propose` → `/opsx:apply` (the workflow's Intake phase will just
bail to that anyway).

**Front-door first:** before launching, resolve load-bearing ambiguity with the
`sdd-clarify` skill (ask the user targeted questions), because the workflow runs in the
background and CANNOT prompt the user mid-run — its only way to ask is to BAIL with
questions that you then relay.

**Ask the reviewer before launching** (also a main-loop question — the workflow can't):
use `AskUserQuestion` to let the user pick `args.reviewer`, recommended-first:
- **greptile** (recommended) — external, forced: bails loudly if it can't produce a
  verified review; needs the greptile CLI authenticated.
- **cavecrew** — local `caveman:cavecrew-reviewer`, no external dependency; use when
  greptile isn't set up or for offline/private review.
- **greptile+cavecrew** — both (belt-and-suspenders for high-blast-radius changes).
Default: read `~/.claude/agentic-sdd-kit.json` — if it has a `defaultReviewer`, offer that as
the recommended option; otherwise default to greptile. Pass the choice as `args.reviewer`.

**How to launch:** call the `Workflow` tool with
`{ scriptPath: "<user-home>/.claude/workflows/sdd-feature-flow.mjs", args: { goal: "<the feature goal in one line>" } }`.

**Phases:** Intake (route/refuse) → Understand (parallel investigators → design brief)
→ Spec gate (author a `--strict`-validated OpenSpec change; a MANDATORY clarity gate
bails with questions on load-bearing unknowns; then a HUMAN APPROVAL gate returns the
full proposal/design/tasks and stops until you approve) → Implement (one task at a time,
floor after each; bails `partial` if not all automatable tasks are done) → Validate
(floor + `openspec --strict`) → Review (greptile is the forced
default reviewer — bails loudly rather than silently degrading to cavecrew) → Ship
(signed commit; push/PR only if `autoPr`).

**args (all optional except goal):**
- `goal` (string, recommended): the one-line feature description.
- `specApproved` (bool, default false): set true on the RE-LAUNCH after you have reviewed
  and approved the spec the human-gate bail returned. Without it, a fresh run stops at the
  human approval gate before writing any code.
- `prTarget` / `base` (string, default `develop`): the branch the PR opens against.
- `diffBase` (string, default `develop`): the fork parent used to compute the review diff
  (a `git merge-base`, NOT the PR target — avoids inflating the diff).
- `reviewer` (string, default `greptile`): `greptile` | `cavecrew` | `greptile+cavecrew`.
  Default forces greptile: if it can't produce a verified review it BAILS (no silent
  cavecrew fallback).
- `autoPr` (bool, default false): if true, the workflow pushes + runs `gh pr create`;
  default false leaves the SIGNED commit local and returns the ready `gh pr create` command.
- `ghUser` (string, default empty): gh account to switch to for Ship; empty uses whatever
  account is already authenticated (no hardcoded user).

The workflow ends at a SIGNED PR to the trunk (never main, never a Claude/Anthropic
co-author trailer, never `--no-verify`). It is never auto-fired by a hook.
