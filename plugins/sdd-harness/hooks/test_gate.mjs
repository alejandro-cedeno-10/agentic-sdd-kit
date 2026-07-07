#!/usr/bin/env node
// Stop gate (project- and stack-agnostic). Before a turn ends, if source files changed
// (working tree / staged / unpushed), run the project's lint+tests and BLOCK on red so the
// turn never finishes with broken code. Auto-detects the stack:
//   - Python (pyproject.toml): `ruff check .` (only if ruff configured) + `pytest -q`
//   - Node   (package.json w/ a "test" script): `<pnpm|yarn|npm> test`
// No matching stack / no source change -> instant no-op. Fail-open on infra errors.
// Respects stop_hook_active (anti-loop) and SDD_HOOKS_DISABLED.
import fs from 'node:fs'
import path from 'node:path'
import { disabled, readStdin, spawnTool } from './_sdd_common.mjs'

const PY = ['.py']
const WEB = ['.ts', '.tsx', '.js', '.jsx', '.vue']

function git(args, cwd) {
  const r = spawnTool('git', args, { cwd, timeout: 20000 })
  return !r.error && r.status === 0 ? (r.stdout || '') : ''
}
function changed(cwd) {
  const s = new Set()
  for (const a of [['diff', '--name-only'], ['diff', '--cached', '--name-only'], ['diff', '--name-only', '@{u}..HEAD']]) {
    for (const l of git(a, cwd).split('\n')) if (l.trim()) s.add(l.trim())
  }
  return [...s]
}
function has(cwd, name) { try { return fs.statSync(path.join(cwd, name)).isFile() } catch { return false } }
function ruffConfigured(cwd) {
  if (has(cwd, 'ruff.toml') || has(cwd, '.ruff.toml')) return true
  try { return fs.readFileSync(path.join(cwd, 'pyproject.toml'), 'utf8').includes('[tool.ruff') } catch { return false }
}
function pm(cwd) { return has(cwd, 'pnpm-lock.yaml') ? 'pnpm' : has(cwd, 'yarn.lock') ? 'yarn' : 'npm' }
function nodeHasTest(cwd) {
  try { return !!((JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')).scripts || {}).test) } catch { return false }
}
function fail(label, out) { process.stderr.write(`Stop gate FAILED — ${label}:\n` + (out || '').slice(-4000)); return 2 }

function main() {
  if (disabled()) return 0
  let data
  try { data = JSON.parse(readStdin()) } catch { return 0 }
  if (data.stop_hook_active) return 0
  const cwd = data.cwd || process.cwd()
  const ch = changed(cwd)
  const py = ch.some((f) => PY.some((e) => f.endsWith(e)))
  const web = ch.some((f) => WEB.some((e) => f.endsWith(e)))

  if (py && has(cwd, 'pyproject.toml')) {
    if (ruffConfigured(cwd)) {
      const r = spawnTool('python', ['-m', 'ruff', 'check', '.'], { cwd, timeout: 120000 })
      if (!r.error && r.status !== 0) return fail('ruff', (r.stdout || '') + (r.stderr || ''))
    }
    const t = spawnTool('python', ['-m', 'pytest', '-q'], { cwd, timeout: 900000 })
    if (!t.error && t.status !== 0) return fail('pytest', t.stdout || '')
  }

  if (web && nodeHasTest(cwd)) {
    const p = pm(cwd)
    const t = spawnTool(p, ['test'], { cwd, timeout: 900000 })
    if (!t.error && t.status !== 0) return fail(`${p} test`, (t.stdout || '') + (t.stderr || ''))
  }

  return 0
}

process.exit(main())
