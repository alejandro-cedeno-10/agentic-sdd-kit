#!/usr/bin/env node
/**
 * agentic-sdd-kit installer.
 *
 * Interactive setup for the SDD harness on this machine's Claude Code config:
 *  - registers + enables the dependency plugins you choose (engram, caveman,
 *    chrome-devtools-mcp) and this kit's own sdd-harness plugin,
 *  - installs the sdd-feature-flow workflow into ~/.claude/workflows/,
 *  - turns on the Workflow tool,
 *  - checks the OpenSpec CLI.
 *
 * Dependency-free (Node built-ins only). Non-destructive: backs settings.json up
 * first and merges rather than overwrites. Re-runnable (idempotent).
 *
 * Usage:  node bin/install.mjs            (interactive)
 *         node bin/install.mjs --yes      (accept every recommended default)
 *         node bin/install.mjs --dry-run  (show what would change, write nothing)
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

// The dependency plugins this kit wires up. Third-party ones are REFERENCED by their
// public marketplace repo (never vendored). chrome-devtools-mcp ships in the built-in
// `claude-plugins-official` marketplace, so it needs no extra marketplace entry.
const KNOWN = {
  engram: { marketplace: 'engram', repo: 'Gentleman-Programming/engram', plugin: 'engram@engram', required: false,
    why: 'persistent cross-session memory (mem_save/mem_search); the harness can save project decisions to it' },
  caveman: { marketplace: 'caveman', repo: 'JuliusBrussee/caveman', plugin: 'caveman@caveman', required: true,
    why: 'REQUIRED by the harness — provides the caveman:cavecrew-investigator/reviewer compressed subagents' },
  'chrome-devtools-mcp': { marketplace: null, plugin: 'chrome-devtools-mcp@claude-plugins-official', required: false,
    why: 'browser automation MCP (navigate, click, screenshot, network) for eval/verification flows' },
}

function log(m) { process.stdout.write(m + '\n') }
function detectConfigDir() {
  if (process.env.CLAUDE_CONFIG_DIR) return process.env.CLAUDE_CONFIG_DIR
  return path.join(os.homedir(), '.claude')
}
function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return fallback }
}
function deriveKitRepo() {
  try {
    const url = execSync('git -C "' + REPO_ROOT + '" remote get-url origin', { encoding: 'utf8' }).trim()
    const m = url.match(/github\.com[:/]([^/]+\/[^/.]+)/)
    return m ? m[1] : null
  } catch { return null }
}

async function ask(rl, question, def = true) {
  if (AUTO) return def
  const hint = def ? 'Y/n' : 'y/N'
  const a = (await new Promise((res) => rl.question(`  ${question} [${hint}] `, res))).trim().toLowerCase()
  if (a === '') return def
  return a === 'y' || a === 'yes' || a === 's' || a === 'si'
}

async function askReviewer(rl) {
  if (AUTO) return 'greptile'
  const a = (await new Promise((res) => rl.question('  default reviewer — [g]reptile / [c]avecrew / [b]oth? [g] ', res))).trim().toLowerCase()
  if (a.startsWith('c')) return 'cavecrew'
  if (a.startsWith('b')) return 'greptile+cavecrew'
  return 'greptile'
}

async function main() {
  const configDir = detectConfigDir()
  const settingsPath = path.join(configDir, 'settings.json')
  const workflowsDir = path.join(configDir, 'workflows')
  const kitRepo = deriveKitRepo() // owner/name of THIS repo, or null

  log('')
  log('  agentic-sdd-kit — installer')
  log('  ' + '-'.repeat(52))
  log(`  Claude config dir : ${configDir}`)
  log(`  This kit repo     : ${kitRepo || '(no git remote — kit plugin will be skipped)'}`)
  log(`  Mode              : ${DRY ? 'DRY-RUN (writes nothing)' : AUTO ? 'auto (recommended defaults)' : 'interactive'}`)
  log('')

  const rl = AUTO ? null : readline.createInterface({ input: process.stdin, output: process.stdout })
  const choose = (q, d) => ask(rl, q, d)

  log('  Choose what to wire up:')
  const want = {
    caveman: true, // required — enabled unconditionally, but told to the user
    engram: await choose('engram   — persistent memory + save project decisions?', true),
    'chrome-devtools-mcp': await choose('chrome-devtools-mcp — browser automation?', true),
    kit: kitRepo ? await choose('sdd-harness plugin (this kit: agents/commands/skills/hooks)?', true) : false,
    workflow: await choose('install the sdd-feature-flow workflow into ~/.claude/workflows/?', true),
  }
  const defaultReviewer = await askReviewer(rl)
  if (rl) rl.close()
  log('')
  log('  caveman is enabled automatically (the harness depends on it).')
  log('')

  // ---- build the settings.json patch ----
  const settings = readJson(settingsPath, {})
  const extraMk = { ...(settings.extraKnownMarketplaces || {}) }
  const enabled = { ...(settings.enabledPlugins || {}) }
  const addMarketplace = (name, repo) => { if (name && repo && !extraMk[name]) extraMk[name] = { source: { source: 'github', repo } } }
  const enablePlugin = (id) => { enabled[id] = true }

  // caveman (required) + chosen third-party
  addMarketplace(KNOWN.caveman.marketplace, KNOWN.caveman.repo); enablePlugin(KNOWN.caveman.plugin)
  if (want.engram) { addMarketplace(KNOWN.engram.marketplace, KNOWN.engram.repo); enablePlugin(KNOWN.engram.plugin) }
  if (want['chrome-devtools-mcp']) enablePlugin(KNOWN['chrome-devtools-mcp'].plugin)
  if (want.kit && kitRepo) { addMarketplace('agentic-sdd-kit', kitRepo); enablePlugin('sdd-harness@agentic-sdd-kit') }

  const patched = { ...settings, extraKnownMarketplaces: extraMk, enabledPlugins: enabled, enableWorkflows: true }

  // ---- workflow install ----
  const wfSrc = path.join(REPO_ROOT, 'plugins', 'sdd-harness', 'workflows', 'sdd-feature-flow.mjs')
  const wfDst = path.join(workflowsDir, 'sdd-feature-flow.mjs')

  // ---- report + apply ----
  log('  Planned changes:')
  log(`   • settings.json: enableWorkflows=true; marketplaces += [${Object.keys(extraMk).join(', ') || 'none'}]`)
  log(`   • enabled plugins += [${Object.keys(enabled).filter((k) => !(settings.enabledPlugins || {})[k]).join(', ') || 'none new'}]`)
  if (want.workflow) log(`   • copy workflow -> ${wfDst}`)
  log(`   • default reviewer: ${defaultReviewer} -> ${path.join(configDir, 'agentic-sdd-kit.json')}`)
  log('')

  if (DRY) { log('  DRY-RUN: nothing written.'); return }

  // backup + write settings
  if (fs.existsSync(settingsPath)) {
    const bak = settingsPath + '.bak-' + new Date().toISOString().replace(/[:.]/g, '-')
    fs.copyFileSync(settingsPath, bak)
    log(`  backed up settings.json -> ${path.basename(bak)}`)
  } else {
    fs.mkdirSync(configDir, { recursive: true })
  }
  fs.writeFileSync(settingsPath, JSON.stringify(patched, null, 2) + '\n')
  log('  settings.json updated.')

  // kit config the launch flow reads for its preferred reviewer default
  const kitCfgPath = path.join(configDir, 'agentic-sdd-kit.json')
  fs.writeFileSync(kitCfgPath, JSON.stringify({ ...readJson(kitCfgPath, {}), defaultReviewer }, null, 2) + '\n')
  log(`  default reviewer set to '${defaultReviewer}'.`)

  if (want.workflow) {
    if (!fs.existsSync(wfSrc)) { log(`  WARN: workflow source not found at ${wfSrc}`) }
    else { fs.mkdirSync(workflowsDir, { recursive: true }); fs.copyFileSync(wfSrc, wfDst); log('  workflow installed.') }
  }

  // openspec CLI check (non-fatal)
  try { execSync('openspec --version', { stdio: 'ignore' }); log('  OpenSpec CLI: found.') }
  catch { log('  OpenSpec CLI: NOT found — install with `npm i -g openspec` (or your package manager).') }

  log('')
  log('  Done. Next steps:')
  log('   1. Restart Claude Code so it picks up the new plugins + settings.')
  log('   2. In a git repo with an openspec/ dir, run `/sdd-clarify` then launch the harness')
  log('      via the Workflow tool (scriptPath ~/.claude/workflows/sdd-feature-flow.mjs).')
  log('   3. Private plugin repos install with your own git credentials on first use.')
  log('')
}

main().catch((e) => { console.error('install failed:', e); process.exit(1) })
