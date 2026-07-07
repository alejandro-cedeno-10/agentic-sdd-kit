// Shared helpers for the SDD/test hooks. Project- and OS-agnostic. Node built-ins only.
//
// A hook is a no-op unless the project actually uses the workflow it guards:
// - SDD hooks act only when `openspec/` is present (an OpenSpec project).
// - "Active change" = the NEWEST change (by `created:` in its `.openspec.yaml`, tie-broken
//   by dir name) still has an incomplete task (`- [ ]`). Pure dir-presence is useless
//   (OpenSpec never moves finished changes out of `openspec/changes/`) and mtime is
//   unreliable. Anchoring on the newest change means: once its tasks are all done you must
//   propose a new change before touching production source again.
//
// Global kill-switch: set SDD_HOOKS_DISABLED=1 to make every hook a no-op.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

export function disabled() {
  return !['', '0', 'false', 'no'].includes(process.env.SDD_HOOKS_DISABLED || '')
}

// Auto-init defaults ON (every project spec-driven). SDD_AUTO_INIT=0 keeps the gate but
// stops it scaffolding openspec/ in new repos.
export function autoInitEnabled() {
  return !['', '0', 'false', 'no'].includes(process.env.SDD_AUTO_INIT ?? '1')
}

// Read ALL of stdin synchronously. Hooks receive their JSON via a pipe, and
// fs.readFileSync(0) returns '' for a pipe (it trusts the fstat size, which is 0), so we
// loop over readSync until EOF. Never throws.
export function readStdin() {
  const chunks = []
  const buf = Buffer.alloc(65536)
  while (true) {
    let n
    try { n = fs.readSync(0, buf, 0, buf.length, null) }
    catch (e) { if (e.code === 'EAGAIN') continue; break }
    if (!n) break
    chunks.push(Buffer.from(buf.subarray(0, n)))
  }
  return Buffer.concat(chunks).toString('utf8')
}

function isDir(p) { try { return fs.statSync(p).isDirectory() } catch { return false } }
function isFile(p) { try { return fs.statSync(p).isFile() } catch { return false } }

// Run an external tool cross-platform: on Windows a CLI installed by npm (openspec, pnpm,
// yarn, npm) is a `.cmd`, so try the common wrappers before giving up. Never throws.
export function spawnTool(name, args, opts = {}) {
  const names = process.platform === 'win32' ? [`${name}.cmd`, `${name}.exe`, name] : [name]
  for (const n of names) {
    const r = spawnSync(n, args, { encoding: 'utf8', ...opts })
    if (!r.error || r.error.code !== 'ENOENT') return r
  }
  return { error: new Error('ENOENT'), status: null, stdout: '', stderr: '' }
}

export function isOpenspecProject(cwd) {
  return isDir(path.join(cwd, 'openspec', 'changes')) || isFile(path.join(cwd, 'openspec', 'config.yaml'))
}

// Make `cwd` an OpenSpec project if it's a git repo that isn't one yet, via a
// non-interactive `openspec init --tools none --force`. Fail-open: any problem (auto-init
// off, not a git repo, no CLI, init error) returns false so the caller no-ops — never
// blocks an edit because setup failed. Idempotent once openspec/ exists.
export function ensureOpenspecProject(cwd) {
  if (isOpenspecProject(cwd)) return true
  if (!autoInitEnabled()) return false
  if (!isDir(path.join(cwd, '.git'))) return false
  const r = spawnTool('openspec', ['init', '--tools', 'none', '--force', cwd], { cwd, timeout: 30000, stdio: 'ignore' })
  if (r.error) return false
  return isOpenspecProject(cwd)
}

function readCreated(changeDir) {
  for (const fn of ['.openspec.yaml', '.openspec.yml']) {
    try {
      for (const line of fs.readFileSync(path.join(changeDir, fn), 'utf8').split('\n')) {
        const s = line.trim()
        if (s.startsWith('created:')) return s.slice('created:'.length).trim()
      }
    } catch { /* try next filename */ }
  }
  return ''
}

export function hasActiveChange(cwd) {
  const changesDir = path.join(cwd, 'openspec', 'changes')
  let entries
  try { entries = fs.readdirSync(changesDir, { withFileTypes: true }) } catch { return false }
  const candidates = []
  for (const e of entries) {
    if (!e.isDirectory() || e.name === 'archive') continue
    const tasks = path.join(changesDir, e.name, 'tasks.md')
    if (!isFile(tasks)) continue
    candidates.push([readCreated(path.join(changesDir, e.name)), e.name, tasks])
  }
  if (!candidates.length) return false
  // newest = max by (created, name), matching the Python tuple sort
  candidates.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
  const newestTasks = candidates[candidates.length - 1][2]
  try { return fs.readFileSync(newestTasks, 'utf8').includes('- [ ]') } catch { return false }
}
