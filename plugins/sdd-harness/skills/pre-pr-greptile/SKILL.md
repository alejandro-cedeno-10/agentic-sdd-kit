---
name: pre-pr-greptile
description: >
  Pre-flight before creating a pull request: run `greptile review` on the committed
  branch, VERIFY the review actually matches this branch's diff, triage its findings,
  apply safe fixes (propose risky ones), and only then `gh pr create`. Runs in repos
  where greptile is configured. Trigger ONLY on explicit PR-creation intent: "crea el
  PR", "create the PR", "abrí el PR", "open a PR", or immediately before a `gh pr create`.
  Do NOT fire on a bare commit.
---

# Pre-PR Greptile Review

A pre-PR review gate. Greptile reviews the committed branch's diff on its own cloud
(≈$0 Claude tokens, ~$1/review after the monthly free tier), and this skill triages the
result and drives the PR. It is a GATE, not blind automation: the review output is
verified and risky findings are proposed, not auto-applied.

Mirrors Greptile's own official `cli-review` skill (whoami → `--json` primary, `--agent`
fallback, findings ranked by severity) and adapts its `greploop` iterate-until-clean idea
to the LOCAL CLI (greploop itself drives the PR bot via `gh`, not the local review).

## Prerequisites

- **Preflight (mirrors greptile's official `cli-review`):** `git rev-parse --show-toplevel`
  (confirm you're in a repo) → `command -v greptile` (CLI present) → `greptile whoami`
  (auth). Greptile has NO `--fix`/apply command — it only PRODUCES findings; the agent
  applies the fixes (exactly like the official `greploop` skill, which edits files itself).
- **Auth (do NOT `greptile login` from an agent/wrapped shell).** Check with a
  non-interactive `greptile whoami`. If unauthenticated, STOP and tell the user to run
  `greptile login` **in a native terminal** (the browser-OAuth callback is unreliable in
  wrapped/non-interactive shells — it fails with a malformed `redirect_uri`). Headless
  fallback: `export GREPTILE_API_KEY=…` or `echo "$GREPTILE_API_KEY" | greptile login
  --api-key` (never pass the key as a CLI arg — shell history/process list).
- **greptile installed** (`command -v greptile`). If absent/down/rate-limited → STOP and
  surface to the user; never hang and never silently open the PR (see Fail-open).

## The flow

1. **Be on a feature branch with the work committed.** If on a trunk/base branch
   (`testing`, `main`, `develop`) create `feature|bugfix|hotfix/<ticket>-slug` first.
   Greptile reviews the branch diff vs its base, so the work must be committed. Keep every
   commit SSH-**signed** (never `--no-gpg-sign`, never `--no-verify`).
2. **Resolve the base branch explicitly — never assume `main`.** In this org PRs target
   `testing` (the trunk); confirm per repo. `greptile review` defaults to the repo's
   default branch, which may be wrong — pass `-b <base>` to match the intended PR base.
3. **Run the review:** `greptile review -b <base> --json` (primary; introspect the shape
   with `jq 'keys'` — the JSON schema is undocumented, do not hard-code field names).
   Fall back to `greptile review -b <base> --agent` (plain text) if JSON fails.
4. **VERIFY the review matches THIS branch before trusting ANY finding.** Compare the
   review's referenced files against `git diff <base>...HEAD --name-only` (three-dot =
   merge-base, the PR diff). The review's files must be a subset of the branch diff. If
   they don't overlap, or the review returns in **under ~10s** (a cache hit), it is a
   STALE / different-repo review — discard it, run ONCE more fresh, and if it still
   mismatches, STOP and surface. NEVER apply fixes from an unverified review. *(This
   guard exists because a first-call greptile review was observed returning a cached
   review of a completely different repository.)*
5. **Triage findings (verified review only):** rank by severity. Tier each finding:
   - **Mechanical / low-risk** (unused import, typo, missing null-guard, docs/test gap):
     safe to fix directly.
   - **Risky** (auth, crypto, injection, data-loss, concurrency, or ANY logic/behavior
     change): do NOT auto-apply — propose the diff and get explicit user approval first.
   - **False positive / intent-conflicting:** do not apply; record the rationale (for the
     PR body / a later thread reply). Never weaken correctness or security to silence a nit.
6. **Apply fixes, mind the SDD gate.** Editing production source (`.py/.ts/.vue/…`) fires
   the global `sdd_gate` PreToolUse hook, which BLOCKS when the repo is an OpenSpec project
   with no active change — which is the normal state at PR time (all tasks `- [x]`). If a
   production-source fix is blocked: surface it and let the user decide (keep a task open,
   reopen a change, or apply manually). Do **not** auto-set `SDD_HOOKS_DISABLED=1` — that
   defeats the user's spec-first discipline. Fixes under `docs/`, tests, `.claude/`, and
   `openspec/` are exempt and apply freely.
7. **Re-commit the fixes** (signed; prefer `--fixup` + autosquash or a small focused
   commit so the PR history stays clean), then **re-run a FRESH `greptile review`** and
   re-do step 4's diff-match. `--resume` is ONLY for continuing a crashed/interrupted
   review — it does NOT re-review a new commit, so never use it after applying fixes.
8. **Loop to convergence, cap at 3 reviews.** Stop early when only nits/false-positives
   remain or a finding recurs (the fix didn't satisfy it → human call). Count BILLABLE
   reviews (initial + every re-run + any stale re-run) — each is ~$1 after the free tier,
   so don't re-run gratuitously. If not clean after 3, STOP, do NOT create the PR, and
   surface the remaining findings.
9. **Ensure the correct gh account, push, then open the PR.** `gh auth status`; if it
   drifted, `gh auth switch --user <correct-account>` (a wrong account → push/`gh pr
   create` 404 "Repository not found"). `git push` (signed) the branch, then
   `gh pr create --base <base>` — no Claude/Anthropic co-author trailer, no "Generated with
   Claude Code" footer, never `--no-verify`. Never merge the base into the feature branch.

## Definition of "clean"

Zero **unresolved findings you agreed with**. Nits, suggestions, and documented false
positives do NOT block. Persist skipped-finding rationale so the loop stops re-fighting the
same false positive and the gate can pass with recorded waivers.

## Fail-open / fail-safe

A gate must neither deadlock nor silently bypass. If greptile is missing, unauthenticated
(in this shell), erroring, or rate-limited: STOP and hand the decision to the user — never
hang, never open the PR silently. If the user explicitly says to skip the review, honor it
and note in the PR body that the greptile pre-flight was skipped.

## Guardrails

- Never act on a review that fails the diff-match check (step 4). Sub-10s return = suspect.
- Never auto-apply security/behavior-changing findings — propose for approval.
- Never bypass the SDD gate or commit signing to make the loop proceed.
- Keep fixes minimal and on-topic; don't scope-creep the branch to satisfy unrelated nits.
- The optional post-PR summary comment must not publicly expose reasoning about security
  issues you chose not to fix — keep it to resolved items or scrub sensitive detail.
- Each auto-fix edit also triggers whatever PostToolUse hooks and the `Stop` `test_gate`
  are configured in this environment — budget for that latency and let those tests be part
  of "clean".

## Commands

```bash
greptile whoami                      # auth check (never `greptile login` from a wrapped shell)
greptile review -b testing --json    # primary: machine-readable, explicit base
greptile review -b testing --agent   # fallback: plain text for agents
git diff testing...HEAD --name-only  # the diff the review MUST match (step 4)
greptile review show <id>            # reopen a past review
gh auth switch --user <account>      # fix account drift before push / gh pr create
```
