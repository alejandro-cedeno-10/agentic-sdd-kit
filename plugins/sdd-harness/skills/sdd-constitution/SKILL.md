---
name: sdd-constitution
description: Author or update the project's constitution — openspec/project.md — the non-negotiable principles, conventions, and constraints the Spec-Driven Development flow must honor. Modeled on GitHub Spec-Kit's /constitution. Run once per repo when onboarding SDD, or whenever the team's principles change. The sdd-feature-flow Analyze gate checks every spec against it.
---

# Project constitution (openspec/project.md)

A constitution is the short, stable set of rules every change in this repo must respect —
the "house rules" the AI must not violate when it authors specs or writes code. OpenSpec
reads `openspec/project.md`; the `sdd-feature-flow` Analyze phase flags any requirement that
contradicts it (and notes, as an advisory, when it's missing).

## When to use

- A repo adopting SDD has no `openspec/project.md` yet (the Analyze gate will advise this).
- The team's conventions, stack, or constraints changed and the constitution is stale.

## Procedure

1. **Discover, don't dictate.** Read the repo to infer what's already true before proposing
   principles: `README`, `CONTRIBUTING`, existing `CLAUDE.md`/`AGENTS.md`, lint/format config,
   test setup, package manifests, CI, and a few representative modules. Note the real stack,
   the test/lint commands, the branch flow, and any obvious conventions.
2. **Draft `openspec/project.md`** with these sections (keep each tight — principles, not prose):
   - **Purpose** — one paragraph: what this project is.
   - **Tech stack & tooling** — languages, frameworks, package manager, test/lint commands.
   - **Non-negotiable principles** — the rules the AI must never break. Examples: "comment WHY
     not WHAT", "no feature flags via env vars", "sign every commit", "no cross-branch merges
     of environment branches". Draw these from the repo + the user, not from a generic list.
   - **Conventions** — naming, error handling, decimal/precision rules, resource identifiers,
     directory layout — whatever is load-bearing for correctness in THIS repo.
   - **Branch & release flow** — e.g. `feature → develop → testing → main`; PR target defaults.
   - **Definition of done** — tests green, docs updated, spec archived, etc.
3. **Confirm with the user** anything you inferred but couldn't verify from the repo — a
   constitution that's wrong is worse than none.
4. **Validate**: `openspec validate --strict` still passes; the file is referenced by the SDD
   flow automatically (no wiring needed).

## Rules

- Short and non-negotiable beats long and aspirational. If a line isn't enforceable, cut it.
- Ground every principle in the repo or an explicit user statement — never invent house rules.
- This skill writes ONLY `openspec/project.md` (and asks questions). No production code.
