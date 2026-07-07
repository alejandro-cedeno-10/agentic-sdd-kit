#!/usr/bin/env python3
"""PreToolUse SDD gate (global, project-agnostic).

Blocks Edit/Write/MultiEdit of PRODUCTION source files when the project is an
OpenSpec project with NO active change. No-op for non-OpenSpec projects, for
tests/docs/config/spec files, and when SDD_HOOKS_DISABLED is set. Fail-open.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sdd_common import disabled, ensure_openspec_project, has_active_change  # noqa: E402

_SRC_EXT = (".py", ".ts", ".tsx", ".js", ".jsx", ".vue", ".go", ".rs", ".java", ".rb", ".php", ".kt")
_EXEMPT = ("/test", "/tests", "/__tests__", "/spec/", "/specs/", "/docs/", "/openspec/", "/.claude/")


def _is_production(fp: str) -> bool:
    low = "/" + fp.lower().replace("\\", "/")
    if not low.endswith(_SRC_EXT):
        return False
    if any(seg in low for seg in _EXEMPT):
        return False
    base = low.rsplit("/", 1)[-1]
    if base.startswith("test_") or base.startswith("test.") or ".test." in base or ".spec." in base:
        return False
    return True


def main() -> int:
    if disabled():
        return 0
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 0
    if data.get("tool_name") not in ("Edit", "Write", "MultiEdit"):
        return 0
    fp = (data.get("tool_input") or {}).get("file_path") or ""
    if not _is_production(fp):
        return 0
    cwd = data.get("cwd") or os.getcwd()
    # ensure_openspec_project auto-runs `openspec init` for a git repo that is not yet an
    # OpenSpec project (SDD_AUTO_INIT default on). Returns False (-> no-op) when it is not
    # a git repo, auto-init is off, or init failed — never blocks an edit over setup.
    if not ensure_openspec_project(cwd) or has_active_change(cwd):
        return 0
    sys.stderr.write(
        "SDD gate: editing production source with NO active OpenSpec change "
        "(OpenSpec was auto-initialized here if it was missing). Spec before code — "
        "propose a change first (openspec-propose / /opsx:propose) to get "
        "proposal+spec+tasks, then implement. (tests/docs/config not gated; "
        "SDD_AUTO_INIT=0 stops auto-init; SDD_HOOKS_DISABLED=1 bypasses everything.)"
    )
    return 2


if __name__ == "__main__":
    sys.exit(main())
