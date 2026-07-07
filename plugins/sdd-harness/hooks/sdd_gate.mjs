#!/usr/bin/env node
// PreToolUse SDD gate (project-agnostic). Blocks Edit/Write/MultiEdit of PRODUCTION source
// when the project is an OpenSpec project with NO active change. No-op for non-OpenSpec
// projects, for tests/docs/config/spec files, and when SDD_HOOKS_DISABLED is set. Fail-open.
import { disabled, ensureOpenspecProject, hasActiveChange, readStdin } from './_sdd_common.mjs'

const SRC_EXT = ['.py', '.ts', '.tsx', '.js', '.jsx', '.vue', '.go', '.rs', '.java', '.rb', '.php', '.kt']
const EXEMPT = ['/test', '/tests', '/__tests__', '/spec/', '/specs/', '/docs/', '/openspec/', '/.claude/']

function isProduction(fp) {
  const low = '/' + fp.toLowerCase().replace(/\\/g, '/')
  if (!SRC_EXT.some((e) => low.endsWith(e))) return false
  if (EXEMPT.some((seg) => low.includes(seg))) return false
  const base = low.split('/').pop()
  if (base.startsWith('test_') || base.startsWith('test.') || base.includes('.test.') || base.includes('.spec.')) return false
  return true
}

function main() {
  if (disabled()) return 0
  let data
  try { data = JSON.parse(readStdin()) } catch { return 0 }
  if (!['Edit', 'Write', 'MultiEdit'].includes(data.tool_name)) return 0
  const fp = (data.tool_input || {}).file_path || ''
  if (!isProduction(fp)) return 0
  const cwd = data.cwd || process.cwd()
  // ensureOpenspecProject auto-runs `openspec init` for a git repo that is not yet an
  // OpenSpec project (SDD_AUTO_INIT default on). Returns false (-> no-op) when it is not a
  // git repo, auto-init is off, or init failed — never blocks an edit over setup.
  if (!ensureOpenspecProject(cwd) || hasActiveChange(cwd)) return 0
  process.stderr.write(
    'SDD gate: editing production source with NO active OpenSpec change ' +
    '(OpenSpec was auto-initialized here if it was missing). Spec before code — ' +
    'propose a change first (openspec-propose / /opsx:propose) to get proposal+spec+tasks, ' +
    'then implement. (tests/docs/config not gated; SDD_AUTO_INIT=0 stops auto-init; ' +
    'SDD_HOOKS_DISABLED=1 bypasses everything.)'
  )
  return 2
}

process.exit(main())
