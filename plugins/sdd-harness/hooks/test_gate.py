#!/usr/bin/env python3
"""Stop gate (global, project- and stack-agnostic).

Before a turn ends, if source files changed (working tree / staged / unpushed),
run the project's lint+tests and BLOCK on red so the turn never finishes with
broken code. Auto-detects the stack:
  - Python  (pyproject.toml): `ruff check .` (only if ruff config present) + `pytest -q`
  - Node    (package.json w/ a "test" script): `<pnpm|yarn|npm> test`
No matching stack / no source change -> instant no-op. Fail-open on infra errors.
Respects stop_hook_active (anti-loop) and SDD_HOOKS_DISABLED.
"""
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sdd_common import disabled  # noqa: E402

_PY = (".py",)
_WEB = (".ts", ".tsx", ".js", ".jsx", ".vue")


def _git(args, cwd):
    try:
        r = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, timeout=20)
        return r.stdout if r.returncode == 0 else ""
    except Exception:
        return ""


def _changed(cwd):
    out = set()
    out |= set(_git(["diff", "--name-only"], cwd).splitlines())
    out |= set(_git(["diff", "--cached", "--name-only"], cwd).splitlines())
    out |= set(_git(["diff", "--name-only", "@{u}..HEAD"], cwd).splitlines())
    return out


def _run(cmd, cwd, timeout):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)


def _has(cwd, name):
    return os.path.isfile(os.path.join(cwd, name))


def _ruff_configured(cwd):
    if _has(cwd, "ruff.toml") or _has(cwd, ".ruff.toml"):
        return True
    try:
        with open(os.path.join(cwd, "pyproject.toml"), encoding="utf-8") as fh:
            return "[tool.ruff" in fh.read()
    except OSError:
        return False


def _pm(cwd):
    if _has(cwd, "pnpm-lock.yaml"):
        return "pnpm"
    if _has(cwd, "yarn.lock"):
        return "yarn"
    return "npm"


def _node_has_test_script(cwd):
    try:
        with open(os.path.join(cwd, "package.json"), encoding="utf-8") as fh:
            return bool((json.load(fh).get("scripts") or {}).get("test"))
    except Exception:
        return False


def _fail(label, out):
    sys.stderr.write(f"Stop gate FAILED — {label}:\n" + (out or "")[-4000:])
    return 2


def main() -> int:
    if disabled():
        return 0
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 0
    if data.get("stop_hook_active"):
        return 0
    cwd = data.get("cwd") or os.getcwd()
    changed = _changed(cwd)
    py = any(f.endswith(_PY) for f in changed)
    web = any(f.endswith(_WEB) for f in changed)

    if py and _has(cwd, "pyproject.toml"):
        if _ruff_configured(cwd):
            try:
                r = _run(["python", "-m", "ruff", "check", "."], cwd, 120)
            except Exception:
                r = None
            if r is not None and r.returncode != 0:
                return _fail("ruff", (r.stdout or "") + (r.stderr or ""))
        try:
            t = _run(["python", "-m", "pytest", "-q"], cwd, 900)
        except Exception:
            t = None
        if t is not None and t.returncode != 0:
            return _fail("pytest", t.stdout)

    if web and _node_has_test_script(cwd):
        pm = _pm(cwd)
        try:
            t = _run([pm, "test"], cwd, 900)
        except Exception:
            t = None
        if t is not None and t.returncode != 0:
            return _fail(f"{pm} test", (t.stdout or "") + (t.stderr or ""))

    return 0


if __name__ == "__main__":
    sys.exit(main())
