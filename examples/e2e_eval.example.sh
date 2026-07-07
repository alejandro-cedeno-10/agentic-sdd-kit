#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# scripts-dev/e2e_eval.sh — OPTIONAL per-project end-to-end eval hook for the
# agentic-sdd-kit `sdd-feature-flow` harness.
#
# This file is NOT part of the harness. The harness is project-agnostic: in its
# Validate phase it checks whether an executable `scripts-dev/e2e_eval.sh` exists
# in YOUR repo root. If it does not exist, the harness simply skips the e2e step
# and the unit-test floor is the whole gate. If it DOES exist, the harness runs it
# with your shell's own credentials and reads ONLY your exit code.
#
# To use it: copy this file to your repo at `scripts-dev/e2e_eval.sh`, `chmod +x`
# it, and fill in the real checks below.
#
# Exit-code contract (the ONLY thing the harness looks at):
#   0             -> pass          (e2e green; Ship may proceed)
#   1             -> hard_block    (e2e failed; the harness BAILS Validate)
#   anything else -> not_evaluated (fail-open: runtime unreachable / not configured)
#
# $1 is the diff base the harness passes (e.g. `develop`) so you can scope checks
# to what changed. See the `sdd-verify` skill for the surface-aware approach this
# mirrors (chrome-devtools for frontend, Playwright request-context for the API).
# ---------------------------------------------------------------------------
set -uo pipefail
BASE="${1:-develop}"

# What did this change touch? (committed since the fork point + uncommitted)
CHANGED="$( { git diff --name-only "$BASE"...HEAD 2>/dev/null; git status --porcelain | awk '{print $2}'; } | sort -u )"

# --- API surface → Playwright request-context smoke test --------------------
# Uncomment + point at a script that hits the affected endpoints and asserts
# status + response shape (throwaway spec under scripts-dev/):
if echo "$CHANGED" | grep -qiE 'handler|route|controller|resolver|openapi|swagger|/api/'; then
  : # npx playwright test scripts-dev/api_smoke.spec.ts || exit 1
fi

# --- Frontend surface → headless UI render check ----------------------------
# Uncomment + run your headless check (Playwright browser test, a Lighthouse
# budget, or drive chrome-devtools-mcp from a small script). Exit 1 on failure:
if echo "$CHANGED" | grep -qiE '\.(tsx|jsx|vue|svelte|css|scss|html)$'; then
  : # npx playwright test scripts-dev/ui_smoke.spec.ts || exit 1
fi

# Nothing failed (or nothing applicable ran) -> pass.
exit 0
