---
name: sdd-clarify
description: >
  Front door of the SDD flow. When the user asks for a feature or bug fix ("implementa…",
  "agrega…", "arregla…", "add…", "build…", "fix…"), FIRST scan the request + codebase
  context for load-bearing ambiguity and ask a few targeted clarifying questions (selectable
  options, recommended first) BEFORE writing any spec or code — then hand a well-formed goal
  to /opsx:propose (small) or the sdd-feature-flow workflow (large). Skip the questions when
  the request is already unambiguous. Modeled on GitHub Spec-Kit's /clarify.
---

# SDD Clarify — ask well, build once

The cheapest token is the one you don't spend re-doing work. A vague request implemented
blind burns iterations (implement → wrong → re-implement → re-review). This skill front-loads
the ambiguity: a short, sharp clarification pass turns a fuzzy ask into a well-scoped SDD
change, so the implement/review loop runs once. Modeled on GitHub Spec-Kit's `/speckit.clarify`
and Matt Pocock's `grill-me` skill (interview until shared understanding, resolving each branch
of the decision tree, with a recommended answer per question) — adapted to be token-frugal.

## When to use

On any feature/bug request, BEFORE proposing a spec or touching code. It is the step that
feeds `/opsx:propose` (or the workflow's spec phase) a goal that's actually pinned down.

## The clarify pass

1. **Gather context cheaply first.** Read only what's needed to know what's ALREADY decided
   by the code/specs — existing modules, related specs, conventions. Never ask the user
   something the repo already answers. (Use a cheap read/locate, not a deep dive.)
2. **Scan for ambiguity across these dimensions** (Spec-Kit's set) — keep only the ones that
   are genuinely unresolved AND change what you'd build:
   - Functional scope & boundaries (what's in / explicitly out)
   - Data model / entities / persistence
   - Integration & dependencies (which services/events/contracts it touches)
   - Edge cases & failure behavior (fail-open? errors? empty/limits?)
   - Non-functional (latency budget, security/authz, idempotency)
   - Terminology / domain (disambiguate overloaded terms — e.g. bill vs invoice)
3. **Ask the questions — decision-tree aware (grill-me), but token-frugal.** Order them by the
   decision tree: scope decisions first, they gate the rest. Batch the INDEPENDENT questions
   into ONE `AskUserQuestion` call (2–4 selectable options each, the RECOMMENDED option first
   and labeled, so answering is a click, not an essay) — that saves round-trips. When an answer
   opens a genuinely NEW dependent branch (a follow-up that only makes sense given that answer),
   do ONE more short round for it — resolve each branch, don't guess across it. Never batch two
   questions that depend on each other; never ask what the code already decides or what has an
   obvious default (state the default and move on). If the request is unambiguous, **ask
   nothing** and go straight to step 5. Cap the whole pass at ~2 rounds — grilling forever is
   its own waste.
4. **Fold the answers into the proposal.** Every answer becomes an explicit line in the
   OpenSpec proposal/spec (scope, decisions, edge cases) — the spec, not chat, is the record.
5. **Route to SDD:**
   - Small / single-file / bugfix → `/opsx:propose` then `/opsx:apply`.
   - Large / cross-cutting / chat-surface → launch the **sdd-feature-flow** workflow with the
     clarified goal (it can't ask the user mid-run, so the clarity must come from HERE).
6. **Review at PR time is not this skill's job** — it's the **pre-pr-greptile** skill: when the
   change is implemented and you go to open the PR, that runs `greptile review`, verifies the
   diff match, triages, and gates the PR. Clarify → spec → implement → **greptile review** → PR.

## Guardrails

- **Don't over-ask.** Over-questioning is its own waste (of the user's time AND tokens). 3–4
  sharp questions max; zero if the ask is clear. Recommended-first options so the user can
  one-click the default.
- **Never invent facts to fill a gap** — if something is unknown and load-bearing, ask; if it's
  unknown and minor, pick a sensible default and state it in the spec.
- Ambiguity resolved here MUST be written into the OpenSpec artifacts, not left in chat.
- Respect the SDD gate: production-source edits still require the active change this produces.
