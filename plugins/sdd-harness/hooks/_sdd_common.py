"""Shared helpers for the global SDD/test hooks. Project- and OS-agnostic.

A hook is a no-op unless the project actually uses the workflow it guards:
- SDD hooks act only when `openspec/` is present (an OpenSpec project).
- "Active change" = the NEWEST change (by `created:` in its `.openspec.yaml`,
  tie-broken by dir name) still has an incomplete task (`- [ ]`). Pure
  dir-presence is useless because OpenSpec never moves finished changes out of
  `openspec/changes/`, and mtime is unreliable (git checkout/reset rewrites it,
  and stale changes keep stray unchecked closing tasks). Anchoring on the
  newest change means: once its tasks are all done you must propose a new
  change before touching production source again.

Global kill-switch: set SDD_HOOKS_DISABLED=1 to make every hook a no-op.
"""
import glob
import os
import shutil
import subprocess


def disabled() -> bool:
    return os.environ.get("SDD_HOOKS_DISABLED", "") not in ("", "0", "false", "no")


def auto_init_enabled() -> bool:
    """Auto-init defaults ON (the user wants every project spec-driven). Set
    SDD_AUTO_INIT=0 to keep the gate but stop it scaffolding openspec/ in new repos."""
    return os.environ.get("SDD_AUTO_INIT", "1") not in ("", "0", "false", "no")


def ensure_openspec_project(cwd: str) -> bool:
    """Make `cwd` an OpenSpec project if it is a git repo that isn't one yet, via a
    NON-INTERACTIVE `openspec init --tools none --force`. Returns True if it is (or just
    became) an OpenSpec project. Fail-open: any problem (auto-init off, not a git repo, no
    CLI on PATH, init error/timeout) returns False so the caller no-ops — never blocks an
    edit because setup failed. Idempotent: a no-op once openspec/ exists."""
    if is_openspec_project(cwd):
        return True
    if not auto_init_enabled():
        return False
    if not os.path.isdir(os.path.join(cwd, ".git")):
        return False
    exe = shutil.which("openspec")
    if not exe:
        return False
    try:
        subprocess.run(
            [exe, "init", "--tools", "none", "--force", cwd],
            cwd=cwd,
            capture_output=True,
            timeout=30,
            stdin=subprocess.DEVNULL,
        )
    except Exception:
        return False
    return is_openspec_project(cwd)


def is_openspec_project(cwd: str) -> bool:
    return os.path.isdir(os.path.join(cwd, "openspec", "changes")) or os.path.isfile(
        os.path.join(cwd, "openspec", "config.yaml")
    )


def _read_created(change_dir: str) -> str:
    for fn in (".openspec.yaml", ".openspec.yml"):
        path = os.path.join(change_dir, fn)
        if not os.path.isfile(path):
            continue
        try:
            with open(path, encoding="utf-8") as fh:
                for line in fh:
                    stripped = line.strip()
                    if stripped.startswith("created:"):
                        return stripped.split(":", 1)[1].strip()
        except OSError:
            return ""
    return ""


def has_active_change(cwd: str) -> bool:
    candidates = []
    for tasks in glob.glob(os.path.join(cwd, "openspec", "changes", "*", "tasks.md")):
        change_dir = os.path.dirname(tasks)
        name = os.path.basename(change_dir)
        if name == "archive":
            continue
        candidates.append((_read_created(change_dir), name, tasks))
    if not candidates:
        return False
    _, _, newest_tasks = max(candidates, key=lambda c: (c[0], c[1]))
    try:
        with open(newest_tasks, encoding="utf-8") as fh:
            return "- [ ]" in fh.read()
    except OSError:
        return False
