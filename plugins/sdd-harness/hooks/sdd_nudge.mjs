#!/usr/bin/env node
// UserPromptSubmit SDD nudge (project-agnostic). In an OpenSpec project with no active
// change, a soft reminder to propose a change first when the prompt looks like an
// implementation request. Non-blocking. Fail-open.
import { disabled, hasActiveChange, isOpenspecProject, readStdin } from './_sdd_common.mjs'

const INTENT = /\b(implementa|implementar|agrega|agregar|construye|construir|arregla|arreglar|implement|add|build|fix|feature|feat|refactor)\b/

// Heuristic for a large/cross-cutting request worth suggesting the opt-in sdd-feature-flow
// workflow. Conservative so one-liners are never nudged toward an expensive workflow.
function isSubstantial(prompt) {
  const text = prompt.trim()
  const separators = (text.match(/[.;\n,]|\s+y\s+|\band\b/g) || []).length
  return text.length >= 200 || separators >= 3
}

function maybeSuggestWorkflow(prompt) {
  try {
    if (isSubstantial(prompt)) {
      process.stdout.write(
        '[SDD] Large / cross-cutting feature? The opt-in sdd-feature-flow workflow can ' +
        'conduct route -> validated change -> implement -> validation gate -> adversarial ' +
        'review -> signed PR. Launch it yourself (/sdd-feature-flow); it is never auto-run. ' +
        'Small change -> just /opsx:propose.\n'
      )
    }
  } catch { /* purely suggestive; never break the hook */ }
}

function main() {
  if (disabled()) return 0
  let data
  try { data = JSON.parse(readStdin()) } catch { return 0 }
  const prompt = data.prompt || ''
  if (!INTENT.test(prompt.toLowerCase())) return 0
  const cwd = data.cwd || process.cwd()
  if (!isOpenspecProject(cwd) || hasActiveChange(cwd)) return 0
  process.stdout.write(
    '[SDD reminder] Implementation-like request and no active OpenSpec change. Per the ' +
    'spec-driven workflow, propose a change first (openspec-propose / /opsx:propose) — ' +
    'proposal -> spec -> tasks -> implement. Skip for trivial edits.\n'
  )
  maybeSuggestWorkflow(prompt)
  return 0
}

process.exit(main())
