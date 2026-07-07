#!/usr/bin/env node
/**
 * agentic-sdd-kit installer.
 *
 * Interactive, per-step setup on this machine's Claude Code install:
 *  - actively installs each dependency you choose via the `claude plugin` CLI
 *    (marketplace add + install): caveman (required), engram, chrome-devtools-mcp,
 *    and this kit's own sdd-harness plugin,
 *  - installs the sdd-feature-flow workflow into ~/.claude/workflows/,
 *  - turns on the Workflow tool and records a default reviewer,
 *  - checks the OpenSpec CLI.
 *
 * If the `claude` CLI isn't on PATH it falls back to writing settings.json directly
 * (Claude Code then installs the plugins on next start). Dependency-free, re-runnable,
 * non-destructive (backs settings.json up first).
 *
 * Usage:  node bin/install.mjs           (interactive)
 *         node bin/install.mjs --yes     (accept every recommended default)
 *         node bin/install.mjs --dry-run (show the steps, run/write nothing)
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import readline from 'node:readline'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ARGS = new Set(process.argv.slice(2))
const AUTO = ARGS.has('--yes') || ARGS.has('-y')
const DRY = ARGS.has('--dry-run')

// Third-party plugins are REFERENCED by their public marketplace repo (never vendored).
// chrome-devtools-mcp ships in the built-in `claude-plugins-official` marketplace.
const DEPS = {
  caveman: { repo: 'JuliusBrussee/caveman', marketplace: 'caveman', plugin: 'caveman@caveman' },
  engram: { repo: 'Gentleman-Programming/engram', marketplace: 'engram', plugin: 'engram@engram' },
  'chrome-devtools-mcp': { repo: null, marketplace: null, plugin: 'chrome-devtools-mcp@claude-plugins-official' },
}

function log(m) { process.stdout.write(m + '\n') }
function detectConfigDir() { return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude') }
function readJson(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return fb } }
function hasCli(bin) { try { execSync(process.platform === 'win32' ? `where ${bin}` : `command -v ${bin}`, { stdio: 'ignore' }); return true } catch { return false } }
function run(cmd, { optional = false } = {}) {
  log(`     $ ${cmd}`)
  if (DRY) return true
  try { execSync(cmd, { stdio: 'inherit' }); return true }
  catch (e) { log(`     ! failed${optional ? ' (continuing)' : ''}: ${e.message.split('\n')[0]}`); if (!optional) throw e; return false }
}
function deriveKitRepo() {
  try { const u = execSync(`git -C "${REPO_ROOT}" remote get-url origin`, { encoding: 'utf8' }).trim(); const m = u.match(/github\.com[:/]([^/]+\/[^/.]+)/); return m ? m[1] : null } catch { return null }
}
async function ask(rl, q, def = true) {
  if (AUTO) return def
  const a = (await new Promise((r) => rl.question(`  ${q} [${def ? 'Y/n' : 'y/N'}] `, r))).trim().toLowerCase()
  return a === '' ? def : ['y', 'yes', 's', 'si'].includes(a)
}
async function askReviewer(rl) {
  if (AUTO) return 'greptile'
  const a = (await new Promise((r) => rl.question('  default reviewer — [g]reptile / [c]avecrew / [b]oth? [g] ', r))).trim().toLowerCase()
  return a.startsWith('c') ? 'cavecrew' : a.startsWith('b') ? 'greptile+cavecrew' : 'greptile'
}

async function main() {
  const configDir = detectConfigDir()
  const settingsPath = path.join(configDir, 'settings.json')
  const workflowsDir = path.join(configDir, 'workflows')
  const kitRepo = deriveKitRepo()
  const CLI = hasCli('claude')

  log('')
  log('  agentic-sdd-kit — installer')
  log('  ' + '-'.repeat(52))
  log(`  Claude config dir : ${configDir}`)
  log(`  This kit repo     : ${kitRepo || '(no git remote)'}`)
  log(`  claude CLI        : ${CLI ? 'found — will install per step' : 'not found — will write settings.json instead'}`)
  log(`  Mode              : ${DRY ? 'DRY-RUN' : AUTO ? 'auto (defaults)' : 'interactive'}`)
  log('')

  const rl = AUTO ? null : readline.createInterface({ input: process.stdin, output: process.stdout })
  log('  Choose what to wire up:')
  const want = {
    engram: await ask(rl, 'engram   — persistent memory + save project decisions?', true),
    'chrome-devtools-mcp': await ask(rl, 'chrome-devtools-mcp — browser automation / frontend validation?', true),
    kit: kitRepo ? await ask(rl, 'sdd-harness plugin (this kit: agents/commands/skills/hooks)?', true) : false,
    workflow: await ask(rl, 'install the sdd-feature-flow workflow into ~/.claude/workflows/?', true),
  }
  const defaultReviewer = await askReviewer(rl)
  if (rl) rl.close()
  log('')
  log('  caveman is installed automatically (the harness depends on it).')
  log('')

  const chosen = ['caveman', ...(want.engram ? ['engram'] : []), ...(want['chrome-devtools-mcp'] ? ['chrome-devtools-mcp'] : [])]

  if (CLI) {
    // --- active per-step install via the claude plugin CLI ---
    log('  Installing plugins (per step):')
    for (const key of chosen) {
      const d = DEPS[key]
      log(`   • ${key}`)
      if (d.repo) run(`claude plugin marketplace add ${d.repo}`, { optional: true })
      run(`claude plugin install ${d.plugin} --scope user`, { optional: true })
    }
    if (want.kit && kitRepo) {
      log('   • sdd-harness (this kit)')
      run(`claude plugin marketplace add ${kitRepo}`, { optional: true })
      run(`claude plugin install sdd-harness@agentic-sdd-kit --scope user`, { optional: true })
    }
  } else {
    // --- fallback: write settings.json (Claude Code installs on next start) ---
    log('  Writing settings.json (plugins install on next Claude Code start):')
    const settings = readJson(settingsPath, {})
    const extraMk = { ...(settings.extraKnownMarketplaces || {}) }
    const enabled = { ...(settings.enabledPlugins || {}) }
    for (const key of chosen) { const d = DEPS[key]; if (d.repo && !extraMk[d.marketplace]) extraMk[d.marketplace] = { source: { source: 'github', repo: d.repo } }; enabled[d.plugin] = true }
    if (want.kit && kitRepo) { extraMk['agentic-sdd-kit'] = { source: { source: 'github', repo: kitRepo } }; enabled['sdd-harness@agentic-sdd-kit'] = true }
    if (!DRY) writeSettings(settingsPath, configDir, { ...settings, extraKnownMarketplaces: extraMk, enabledPlugins: enabled })
    log(`     marketplaces: ${Object.keys(extraMk).join(', ')}`)
  }

  // --- enableWorkflows (the Workflow tool needs it either way) + reviewer default ---
  const settings2 = readJson(settingsPath, {})
  if (!settings2.enableWorkflows) { log('  Enabling the Workflow tool (settings.enableWorkflows = true).'); if (!DRY) writeSettings(settingsPath, configDir, { ...settings2, enableWorkflows: true }) }
  const kitCfgPath = path.join(configDir, 'agentic-sdd-kit.json')
  log(`  Recording default reviewer: ${defaultReviewer}`)
  if (!DRY) fs.writeFileSync(kitCfgPath, JSON.stringify({ ...readJson(kitCfgPath, {}), defaultReviewer }, null, 2) + '\n')

  // --- workflow install ---
  if (want.workflow) {
    const src = path.join(REPO_ROOT, 'plugins', 'sdd-harness', 'workflows', 'sdd-feature-flow.mjs')
    const dst = path.join(workflowsDir, 'sdd-feature-flow.mjs')
    log(`  Installing workflow -> ${dst}`)
    if (!DRY) { if (fs.existsSync(src)) { fs.mkdirSync(workflowsDir, { recursive: true }); fs.copyFileSync(src, dst) } else log(`     ! source not found: ${src}`) }
  }

  // --- openspec CLI check (advisory) ---
  log(`  OpenSpec CLI: ${hasCli('openspec') ? 'found.' : 'NOT found — install with `npm i -g openspec`.'}`)

  log('')
  log(DRY ? '  DRY-RUN complete — nothing was changed.' : '  Done.')
  log('  Next: restart Claude Code, then in a repo with openspec/ run /sdd-clarify and launch the harness.')
  log('')
}

function writeSettings(settingsPath, configDir, obj) {
  if (fs.existsSync(settingsPath)) fs.copyFileSync(settingsPath, settingsPath + '.bak-' + new Date().toISOString().replace(/[:.]/g, '-'))
  else fs.mkdirSync(configDir, { recursive: true })
  fs.writeFileSync(settingsPath, JSON.stringify(obj, null, 2) + '\n')
}

main().catch((e) => { console.error('install failed:', e); process.exit(1) })
