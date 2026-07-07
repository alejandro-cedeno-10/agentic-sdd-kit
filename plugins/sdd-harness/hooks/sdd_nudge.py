#!/usr/bin/env python3
"""UserPromptSubmit SDD nudge (global, project-agnostic).

In an OpenSpec project with no active change, a soft reminder to propose a change
first when the prompt looks like an implementation request. Non-blocking. Fail-open.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sdd_common import disabled, has_active_change, is_openspec_project  # noqa: E402

_INTENT = re.compile(
    r"\b(implementa|implementar|agrega|agregar|construye|construir|arregla|arreglar|"
    r"implement|add|build|fix|feature|feat|refactor)\b"
)


def _is_substantial(prompt: str) -> bool:
    """Heuristic for a large/cross-cutting request worth suggesting the opt-in
    sdd-feature-flow workflow: a long prompt or several clauses. Kept conservative so
    one-liners are never nudged toward an expensive multi-agent workflow. Callers MUST
    wrap this so a bug here can never break UserPromptSubmit across every project."""
    text = prompt.strip()
    separators = len(re.findall(r"[.;\n,]|\s+y\s+|\band\b", text))
    return len(text) >= 200 or separators >= 3


def _maybe_suggest_workflow(prompt: str) -> None:
    """Purely-suggestive second line; NEVER fires anything. Fail-open: any error is
    swallowed so the nudge (and the whole UserPromptSubmit hook) never breaks."""
    try:
        if _is_substantial(prompt):
            print(
                "[SDD] Large / cross-cutting feature? The opt-in sdd-feature-flow "
                "workflow can conduct route -> validated change -> implement -> cheap "
                "validation gate -> adversarial review -> signed PR. Launch it yourself "
                "(/sdd-feature-flow); it is never auto-run. Small change -> just /opsx:propose."
            )
    except Exception:
        return


def main() -> int:
    if disabled():
        return 0
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 0
    prompt = data.get("prompt") or ""
    if not _INTENT.search(prompt.lower()):
        return 0
    cwd = data.get("cwd") or os.getcwd()
    if not is_openspec_project(cwd) or has_active_change(cwd):
        return 0
    print(
        "[SDD reminder] Implementation-like request and no active OpenSpec change. "
        "Per spec-driven workflow, propose a change first (openspec-propose / "
        "/opsx:propose) — proposal -> spec -> tasks -> implement. Skip for trivial edits."
    )
    _maybe_suggest_workflow(prompt)
    return 0


if __name__ == "__main__":
    sys.exit(main())
