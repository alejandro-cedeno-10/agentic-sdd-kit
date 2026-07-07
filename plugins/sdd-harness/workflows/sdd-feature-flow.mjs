export const meta = {
  name: 'sdd-feature-flow',
  description: 'Opt-in dynamic-workflow conductor for the OpenSpec feature lifecycle: intake+REFUSE-first route -> understand -> validated change -> implement -> validate (local unit tests + a project-local e2e-eval hook) -> greptile+triage review (diff-match verified) -> signed PR to trunk. GLOBAL + project-agnostic; reuses the on-disk substrate (openspec CLI, live SDD hooks, greptile CLI, cavecrew reviewers) and delegates any e2e eval to the project via scripts-dev/e2e_eval.sh. Model-tiered (Haiku for mechanical steps, Sonnet for code/spec authoring, never Opus). Never auto-fired; the Workflow tool first-run confirmation is the spend gate.',
  phases: [
    { title: 'Intake', model: 'haiku' },
    { title: 'Understand', model: 'sonnet' },
    { title: 'Spec gate', model: 'sonnet' },
    { title: 'Analyze', model: 'sonnet' },
    { title: 'Persist', model: 'haiku' },
    { title: 'Implement', model: 'sonnet' },
    { title: 'Validate', model: 'haiku' },
    { title: 'Review', model: 'haiku' },
    { title: 'Ship', model: 'haiku' },
  ],
}

// ------------------------------------------------------------------ config
// args may be a plain string (the goal) or an object. All optional.
const A = typeof args === 'string' ? { goal: args } : args && typeof args === 'object' ? args : {}
const GOAL = (A.goal || '').toString()
const PR_TARGET = (A.prTarget || A.base || 'develop').toString() // where the feature PR opens (org flow: feature -> develop)
const DIFF_BASE = (A.diffBase || 'develop').toString() // fork parent for review/eval diffs; reviewers compute git merge-base ${DIFF_BASE} HEAD, NOT the PR target (avoids inflating the diff with commits the trunk has but the fork point does not)
const REGION = (A.region || 'us-east-1').toString()
const REVIEWER = (A.reviewer || 'greptile').toString() // 'greptile' | 'cavecrew' | 'greptile+cavecrew'
const AUTO_PR = A.autoPr === true // default false: stop before the outward gh action
const GH_USER = (A.ghUser || '').toString() // optional gh account for Ship; empty -> use whatever gh account is already authenticated (portable, no hardcoded user)
const MAX_TASKS = 12
const MAX_TASK_FIX_RETRIES = 2
const MAX_VALIDATE_ITERS = 3
const MAX_REVIEW_LOOPBACKS = 1

// Model tiering (the user's rule: model per task, never Opus). The orchestrator
// inherits the SESSION model by default, which can be Opus — so every agent pins a
// tier explicitly. CHEAP = mechanical (run a shell command, classify, parse output).
// CODE = writing/reading code or specs (needs capability, still not Opus).
const CHEAP = { model: 'haiku', effort: 'low' }
const CODE = { model: 'sonnet', effort: 'high' }
// Spec-gate authoring/validation/recheck is the highest-leverage, lowest-call-count phase
// (~2-5 agent calls per run): a wrong architectural call here (e.g. static-vs-dynamic catalog
// choice) cascades into wasted implementation. Still Sonnet (never Opus, per the user's standing
// rule) but at MAX effort: the CRI incident's root cause was the gate design (assumptions parked
// as footnotes instead of triggering a bail), not model capability — Sonnet already produced a
// well-reasoned design.md once the gate forced the right questions. Max effort buys more
// reasoning depth on the same model, without the Opus cost multiplier, for the phase where a
// wrong call is most expensive to unwind.
const PLAN = { model: 'sonnet', effort: 'max' }

// The eval-arming detector is CHANGE-ID / GOAL regex ONLY (user decision): bare module
// tokens like "stream"/"router" over-match and would false-arm a 15-25 min
// production-hitting gate.
const CHAT_SURFACE_RE = /chat|ask.?brain|synthes|steering|navi|answer|citation|retrieval|rag/i

// ------------------------------------------------------------------ schemas
const ROUTE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_openspec', 'size', 'chat_surface', 'active_change_id', 'affected_modules', 'recommendation'],
  properties: {
    is_openspec: { type: 'boolean' },
    size: { type: 'string', enum: ['small', 'large'] },
    chat_surface: { type: 'boolean' },
    active_change_id: { type: ['string', 'null'] },
    affected_modules: { type: 'array', items: { type: 'string' } },
    recommendation: { type: 'string' },
  },
}
const BRIEF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['design_brief', 'touched_files', 'notes'],
  properties: {
    design_brief: { type: 'string' },
    touched_files: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
}
const CHANGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['change_id', 'validated', 'detail', 'needs_clarification', 'questions'],
  properties: {
    change_id: { type: 'string' },
    validated: { type: 'boolean' },
    detail: { type: 'string' },
    needs_clarification: { type: 'boolean' },
    questions: { type: 'array', items: { type: 'string' } },
  },
}
const SPEC_CONTENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['proposal', 'design', 'tasks'],
  properties: {
    proposal: { type: 'string' },
    design: { type: 'string' },
    tasks: { type: 'string' },
  },
}
const FLOOR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['exit_code', 'passed', 'tail'],
  properties: {
    exit_code: { type: 'number' },
    passed: { type: 'boolean' },
    tail: { type: 'string' },
  },
}
const IMPL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tasks_done', 'tasks_total', 'all_green', 'blocked_reason'],
  properties: {
    tasks_done: { type: 'number' },
    tasks_total: { type: 'number' },
    all_green: { type: 'boolean' },
    blocked_reason: { type: ['string', 'null'] },
  },
}
// End-to-end eval is DELEGATED to a project-local script (`scripts-dev/e2e_eval.sh`):
// this global workflow is project-agnostic, so it never hardcodes one repo's eval. The
// project script owns ALL project-specific logic (whether to arm from the diff, how to
// run, the fail-open discriminator) and speaks ONLY through its exit code.
const E2E_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'exit_code', 'detail', 'tail'],
  properties: {
    status: { type: 'string', enum: ['skipped', 'pass', 'hard_block', 'not_evaluated'] },
    exit_code: { type: 'number' },
    detail: { type: 'string' },
    tail: { type: 'string' },
  },
}
// Greptile run + MANDATORY diff-match verification (the stale/cross-repo cache-hit
// guard, verified live: a first-call greptile review returned a cached review of a
// DIFFERENT repo in ~4s). status: ok = verified against this diff; stale = files did
// not match / sub-10s cache hit; unauth/unavailable = degrade to cavecrew.
const GREPTILE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'elapsed_s', 'summary', 'findings', 'review_files', 'diff_files', 'note'],
  properties: {
    status: { type: 'string', enum: ['ok', 'stale', 'unauth', 'unavailable'] },
    elapsed_s: { type: 'number' },
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'file', 'line', 'body'],
        properties: {
          severity: { type: 'string' },
          file: { type: 'string' },
          line: { type: ['number', 'null'] },
          body: { type: 'string' },
        },
      },
    },
    review_files: { type: 'array', items: { type: 'string' } },
    diff_files: { type: 'array', items: { type: 'string' } },
    note: { type: 'string' },
  },
}
const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['confirmed_blocking', 'findings', 'verdict'],
  properties: {
    confirmed_blocking: { type: 'number' },
    findings: { type: 'array', items: { type: 'string' } },
    verdict: { type: 'string' },
  },
}
const SHIP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['committed', 'branch', 'pr_url', 'pr_command', 'guards', 'detail'],
  properties: {
    committed: { type: 'boolean' },
    branch: { type: 'string' },
    pr_url: { type: ['string', 'null'] },
    pr_command: { type: 'string' },
    guards: { type: 'string' },
    detail: { type: 'string' },
  },
}

// ------------------------------------------------------------------ Phase 0
phase('Intake')
const route = await agent(
  `You are the intake/route classifier for an OpenSpec feature-dev workflow. Read-only, ONE cheap turn. In the current repo run \`git diff --stat\`, \`git status --short\`, and check for an \`openspec/\` dir and the newest active OpenSpec change (a changes/<id> whose tasks.md still has an unchecked "- [ ]").\n\nUSER GOAL: ${JSON.stringify(GOAL)}\n\nEmit a routing manifest:\n- is_openspec: does openspec/ exist here.\n- size: "small" for a single-file edit / bugfix / docs-or-spec-only change that one /opsx:propose->/opsx:apply cycle handles; "large" for a genuinely multi-task or cross-cutting change worth this workflow. Size by the GOAL's INHERENT blast radius, NOT by whether openspec artifacts already exist: an absent or bare scaffold (a changes/<id> with only .openspec.yaml and no tasks.md) does NOT make the change small — the workflow authors the proposal+tasks itself in the Spec-gate phase. A new capability, a new country/variant, or anything touching multiple files is "large" even when zero spec files exist yet.\n- chat_surface: true ONLY if the active change-id OR the user goal matches chat/ask_brain/synthesis/steering/navi/answer/citation/retrieval/rag. Do NOT set it from bare module names alone. This flag arms a 15-25 min production-hitting eval, so bias toward false.\n- active_change_id: the newest change whose tasks.md EXISTS and still has an unchecked "- [ ]", or null. A change dir with only .openspec.yaml (no tasks.md) is NOT active — return null so the Spec-gate phase authors it fresh.\n- affected_modules: top-level dirs/modules the goal or diff touches.\n- recommendation: if is_openspec is false OR size is small, a one-line "use /opsx:propose -> /opsx:apply directly" note; else "proceed with sdd-feature-flow".\n\nBias toward size="small" for genuinely trivial changes (bailing to /opsx cheaply is the win there) — but do NOT let an incomplete or missing spec scaffold pull a multi-file / cross-cutting / new-capability GOAL down to "small". Judge the feature, not the paperwork.`,
  { label: 'route', phase: 'Intake', schema: ROUTE_SCHEMA, agentType: 'general-purpose', ...CHEAP }
)

if (!route || !route.is_openspec || route.size === 'small') {
  log(`Intake bailed: ${route ? route.recommendation : 'no route manifest'}`)
  return {
    bailed: true,
    reason: route && !route.is_openspec ? 'not an OpenSpec project' : 'change too small for the workflow',
    recommendation: route ? route.recommendation : 'use /opsx:propose -> /opsx:apply directly',
    route,
  }
}
log(`Route: large change, chat_surface=${route.chat_surface}, active_change=${route.active_change_id || 'none'}`)

// ------------------------------------------------------------------ Phase 1
phase('Understand')
const investigators = (route.affected_modules.length ? route.affected_modules : ['(whole repo)']).slice(0, 4)
const findings = (await parallel(
  investigators.slice(0, 2).map((mod) => () =>
    agent(
      `Read-only locate. For the goal ${JSON.stringify(GOAL)}, map the blast radius in module "${mod}": the files/functions that must change, their callers, and any invariant a change here could break. Return a compact file:line list + a one-paragraph note. Do NOT propose fixes and do NOT write anything.`,
      { label: `investigate:${mod}`, phase: 'Understand', agentType: 'caveman:cavecrew-investigator', ...CODE }
    )
  )
)).filter(Boolean)

const brief = await agent(
  `Synthesize these read-only investigation notes into ONE design brief for the goal ${JSON.stringify(GOAL)}: the touched-file set and, where knowable, which tasks are file-independent. Keep it tight.\n\nNOTES:\n${findings.join('\n\n---\n\n')}`,
  { label: 'brief', phase: 'Understand', schema: BRIEF_SCHEMA, agentType: 'general-purpose', ...CODE }
)

// ------------------------------------------------------------------ Phase 2
phase('Spec gate')
let changeId = route.active_change_id
if (!changeId) {
  const authored = await agent(
    `You are the SDD author. There is no active OpenSpec change for this work.\n\nFIRST, a MANDATORY clarity gate (this workflow runs autonomously and CANNOT ask the user mid-run — the ONLY way the user ever gets asked is if you BAIL now with questions). Using the design brief below, enumerate every spec decision whose answer you do NOT know for certain and would fill with an ASSUMPTION about: an external contract or payload shape, an integration string/identifier another system emits, the data model, scope boundaries, template/column structure, or overloaded domain terminology. For EACH assumption ask yourself: could a stakeholder (product, another team, the API owner) plausibly contradict it, AND would being wrong change code, template, or contract STRUCTURE (not merely a cosmetic label or a safely reversible default)? If YES for even ONE, you MUST set needs_clarification=true, return those as up to 6 specific questions (embed in each question the concrete options you would otherwise choose between, marking your recommended default), and create NOTHING. Do NOT write the spec around a load-bearing assumption and park it in an "Open Questions"/"Supuestos" section — a load-bearing unknown is a BAIL, not a footnote. Proceed to author ONLY when every remaining unknown is genuinely cosmetic or safely reversible.\n\nOtherwise (goal is fully specifiable with no load-bearing assumptions): using \`openspec\` CLI conventions, create ONE change (proposal.md + delta spec + design.md + tasks.md) for the goal ${JSON.stringify(GOAL)}, grounded in this design brief:\n\n${brief.design_brief}\n\nRequirements MUST use SHALL/MUST in the first line of each requirement body (the strict parser needs it). Then run \`openspec validate <id> --strict\` and report the change id + whether it passed, with needs_clarification=false. Do NOT write any production code yet.${route.chat_surface ? ' Because this is a chat-surface change, ALSO append regression rows to scripts-dev/eval_chat_questions.jsonl (authoring the rows only — never run the battery).' : ''}`,
    { label: 'author-change', phase: 'Spec gate', schema: CHANGE_SCHEMA, agentType: 'sdd-openspec', ...PLAN }
  )
  if (authored && authored.needs_clarification) {
    log('Spec gate: goal too ambiguous to spec confidently — kicking back to the human with questions.')
    return { bailed: true, phase: 'Spec gate', reason: 'goal too ambiguous to spec confidently; clarify (e.g. via the sdd-clarify skill) and re-launch', questions: authored.questions || [] }
  }
  changeId = authored ? authored.change_id : null
  let validated = authored ? authored.validated : false
  for (let i = 0; !validated && changeId && i < MAX_VALIDATE_ITERS; i++) {
    const fixed = await agent(
      `\`openspec validate ${changeId} --strict\` is still failing. Read the exact validator stderr, fix the change artifacts (most often a requirement body missing SHALL/MUST on its first line, or a malformed delta), and re-run \`openspec validate ${changeId} --strict\`. Report whether it now passes.`,
      { label: `validate-fix:${i + 1}`, phase: 'Spec gate', schema: CHANGE_SCHEMA, agentType: 'sdd-openspec', ...PLAN }
    )
    validated = fixed ? fixed.validated : false
  }
  if (!changeId || !validated) {
    return { bailed: true, phase: 'Spec gate', reason: 'could not produce a --strict-validated OpenSpec change', changeId }
  }
  log(`Validated change: ${changeId}`)

  // Human gate at the Plan -> Implement boundary: a freshly-authored, --strict-validated spec
  // still requires explicit human sign-off before ANY code gets written — even when the clarity
  // gate found no load-bearing ambiguity. Skipped only when the caller re-launches with
  // args.specApproved=true (after having reviewed the spec this bail returns). This mirrors the
  // sdd-openspec agent's own contract ("Plan -> Implement, human gate; never self-approve").
  if (A.specApproved !== true) {
    const specContent = await agent(
      `Read openspec/changes/${changeId}/proposal.md, openspec/changes/${changeId}/design.md, and openspec/changes/${changeId}/tasks.md in FULL, verbatim (no summarizing, no truncation). Return each file's complete content as a string.`,
      { label: 'spec-for-approval', phase: 'Spec gate', schema: SPEC_CONTENT_SCHEMA, agentType: 'general-purpose', ...CHEAP }
    )
    return {
      bailed: true,
      phase: 'Spec gate',
      reason: 'awaiting explicit human approval of the authored spec before implementation (Plan -> Implement human gate)',
      changeId,
      spec: specContent || { proposal: '', design: '', tasks: '', note: 'could not re-read spec files from the agent call; read them from disk at openspec/changes/' + changeId },
      resumeHint: 'Once reviewed and approved, re-launch with args.specApproved=true (same goal, or resumeFromRunId to replay cached calls) to proceed to Implement.',
    }
  }
} else {
  log(`Reusing active change: ${changeId}`)
  const recheck = await agent(
    `An OpenSpec change "${changeId}" already exists and is being RESUMED (not freshly authored). Before ANY implementation: (1) run \`openspec validate ${changeId} --strict\`; (2) re-read its proposal.md / design.md / tasks.md and apply the SAME clarity gate as a fresh author — if ANY UNRESOLVED load-bearing assumption remains (an "Open Questions"/"Supuestos" item that would change code, contract, or template STRUCTURE and is not yet answered), set needs_clarification=true and return those as questions, changing NOTHING. Report change_id, validated, needs_clarification, and questions.`,
    { label: 'resume-recheck', phase: 'Spec gate', schema: CHANGE_SCHEMA, agentType: 'sdd-openspec', ...PLAN }
  )
  if (recheck && recheck.needs_clarification) {
    return { bailed: true, phase: 'Spec gate', reason: 'resumed change has unresolved load-bearing questions; clarify (e.g. via sdd-clarify) and re-launch', questions: recheck.questions || [], changeId }
  }
  if (!recheck || recheck.validated === false) {
    return { bailed: true, phase: 'Spec gate', reason: `resumed change ${changeId} did not pass openspec --strict (or the recheck call failed) — failing closed`, changeId }
  }
}

// ------------------------------------------------------------------ Analyze
// Spec-Kit's /analyze gate: a read-only cross-artifact consistency + coverage pass over the
// approved spec BEFORE any code is written. Catches "the design decided X but no task covers
// it", orphan tasks, and internal contradictions that --strict validation alone misses.
phase('Analyze')
const analysis = await agent(
  `Read-only cross-artifact ANALYSIS of OpenSpec change ${changeId} (Spec-Kit's /analyze gate — run BEFORE implementation, change NOTHING). Read proposal.md, design.md, tasks.md, and the delta spec(s). Verify: (1) COVERAGE — every requirement/scenario in the delta spec maps to at least one task, and every "## Decisions" entry in design.md is reflected in a task; (2) ORPHANS — no task exists that no requirement or decision motivates; (3) CONSISTENCY — proposal, design, tasks and delta agree (no contradictions in scope, data model, naming); (4) CONSTITUTION — if openspec/project.md exists, no requirement violates it (if it does NOT exist, note that as an advisory, not a blocker). Set confirmed_blocking = count of MATERIAL coverage/consistency/constitution gaps (never nits). findings = each gap as "type: artifacts involved — what's missing or contradictory". Give a one-line verdict.`,
  { label: 'analyze', phase: 'Analyze', schema: REVIEW_SCHEMA, agentType: 'general-purpose', ...CODE }
)
if (analysis && analysis.confirmed_blocking > 0) {
  return {
    bailed: true,
    phase: 'Analyze',
    reason: `${analysis.confirmed_blocking} cross-artifact gap(s): the approved spec is internally inconsistent or under-covered. Fix the change artifacts and re-launch. Gaps:\n${(analysis.findings || []).join('\n')}`,
    changeId,
    analysis,
  }
}

// ------------------------------------------------------------------ Persist decisions
// Best-effort: save the change's architectural decisions to engram (persistent memory) so
// they survive across sessions. Skipped gracefully if engram isn't installed or the caller
// opts out (args.saveDecisions === false). NEVER bails the run — a failure here is a no-op.
phase('Persist')
if (A.saveDecisions !== false) {
  await agent(
    `Best-effort memory capture — do NOT fail or block the workflow if anything is unavailable. (1) Read openspec/changes/${changeId}/design.md and extract the "## Decisions" section: each decision + its one-line rationale. (2) Check whether engram is installed by loading its save tool via ToolSearch (query "select:mem_save"); if it does NOT resolve, engram is absent — report "skipped" and change nothing. (3) If mem_save resolved, call it ONCE per material decision, each with a concise title and a body of the decision + why, referencing the change id "${changeId}". Return a one-line note of how many decisions were saved (or "skipped"). Change no code and never throw.`,
    { label: 'persist-decisions', phase: 'Persist', ...CHEAP }
  )
}

// ------------------------------------------------------------------ Phase 3
phase('Implement')
const RUN_FLOOR = `You are the deterministic FLOOR runner. In the repo root, if pyproject.toml exists run \`python -m ruff check .\` (only if ruff is configured) then \`python -m pytest -q\`; else if package.json exists, detect the package manager — if pnpm-lock.yaml is present you MUST use pnpm (never infer npm/yarn when a pnpm lock exists), else use the manager matching the lockfile — and run its test script AND its lint script if one is defined (both must be green). Return the real exit code (nonzero if ANY of them failed), passed=true only if all green, and the last ~25 lines. Run nothing else, change nothing.`

const impl = await agent(
  `You are the SDD builder. Implement the tasks of OpenSpec change ${changeId} ONE AT A TIME (read tasks.md / \`openspec show ${changeId} --json\`), up to ${MAX_TASKS} tasks. After EACH task, run the floor yourself (ruff+pytest / pm test) and do not advance a task while red — fix and re-run, at most ${MAX_TASK_FIX_RETRIES} retries per task, then stop and report blocked. Mark each finished task \`- [x]\`. Follow the house rules strictly: NO inline comments inside function bodies (docstrings for WHY only), NO ticket tags in code, NO env-var feature gates (validated feature = default ON with a getattr kill-switch), fail-open. Report tasks_done/tasks_total, all_green, and blocked_reason (null if fine).`,
  { label: 'implement', phase: 'Implement', schema: IMPL_SCHEMA, agentType: 'sdd-openspec', ...CODE }
)
if (!impl) {
  return { bailed: true, phase: 'Implement', reason: 'implement agent returned no result (call failed/timed out) — failing closed', changeId }
}
if (impl.blocked_reason) {
  return { bailed: true, phase: 'Implement', reason: impl.blocked_reason, changeId, impl }
}
// Independently reconcile the agent's self-reported completion against tasks.md, then hard-stop on
// ANY partial completion so Validate/Review/Ship (and Ship's archive) never run on an incomplete change.
const taskCheck = await agent(
  `Read openspec/changes/${changeId}/tasks.md. Count AUTOMATABLE tasks ONLY — EXCLUDE any task under a section heading indicating human/manual/deploy work (heading contains "QA manual", "pendiente humano", "manual", "post-deploy", or "deploy"), and EXCLUDE tasks that are solely about creating the git commit/branch/PR/push (the Ship phase owns those). Of the REMAINING automatable code/test/docs/spec tasks: done = number of "- [x]", total = "- [x]" plus "- [ ]". Return exit_code 0, passed = (done === total), and tail = "automatable done/total; remaining automatable: <names or none>; excluded manual/ship: N". Change nothing.`,
  { label: 'task-reconcile', phase: 'Implement', schema: FLOOR_SCHEMA, agentType: 'general-purpose', ...CHEAP }
)
const reconciledIncomplete = taskCheck ? taskCheck.passed === false : true // reconcile (automatable-only, excludes manual/QA/ship) is authoritative; no result -> fail closed
if (reconciledIncomplete) {
  return {
    bailed: true,
    partial: true,
    phase: 'Implement',
    reason: `partial completion: ${impl.tasks_done}/${impl.tasks_total} tasks self-reported${taskCheck ? `; tasks.md reconcile: ${taskCheck.tail || 'mismatch'}` : '; reconcile call failed'} (MAX_TASKS=${MAX_TASKS} budget reached or work remains). NOT proceeding to Validate/Review/Ship on an incomplete change — resume in a follow-up run or hand off with a stated reason.`,
    changeId,
    impl,
    taskCheck,
  }
}

// ------------------------------------------------------------------ Phase 4
phase('Validate')
const floor = await agent(RUN_FLOOR, { label: 'floor-final', phase: 'Validate', schema: FLOOR_SCHEMA, agentType: 'general-purpose', ...CHEAP })
const specOk = await agent(
  `Run \`openspec validate ${changeId} --strict\` and report exit_code, passed, and the tail.`,
  { label: 'spec-validate', phase: 'Validate', schema: FLOOR_SCHEMA, agentType: 'general-purpose', ...CHEAP }
)

let evalVerdict = { status: 'skipped', detail: 'no project e2e-eval; local unit-test floor is the whole gate' }
const ev = await agent(
  `Project-local END-TO-END eval hook (project-agnostic — no assumptions about what the eval is). Check whether an executable \`scripts-dev/e2e_eval.sh\` exists in the repo root. If it does NOT exist, report status "skipped" and do nothing — the local unit-test floor is the whole gate for this project. If it DOES exist, run \`bash scripts-dev/e2e_eval.sh ${DIFF_BASE}\` using THIS shell's own environment/credentials (do NOT assume-role, do NOT add flags, do NOT widen IAM). Capture the exit code and the last ~30 lines. The script owns ALL logic and speaks only via its exit code: 0 -> status "pass", 1 -> status "hard_block", any other code (2, 124, …) -> status "not_evaluated" (the script's own fail-open path, e.g. runtime unreachable). Report status, exit_code, a one-line detail, and the tail.`,
  { label: 'e2e-eval', phase: 'Validate', schema: E2E_SCHEMA, agentType: 'general-purpose', ...CHEAP }
)
if (ev && ev.status) {
  evalVerdict = { status: ev.status, detail: ev.detail || '', exit_code: ev.exit_code, tail: ev.tail }
  if (ev.status !== 'skipped') log(`E2E eval gate: ${ev.status} — ${ev.detail}`)
}

const floorRed = !floor || !floor.passed // null result (agent failed) -> red, fail closed
const specRed = !specOk || !specOk.passed // null result (agent failed) -> red, fail closed
if (floorRed || specRed || evalVerdict.status === 'hard_block') {
  return {
    bailed: true,
    phase: 'Validate',
    reason: floorRed ? 'tests/ruff red' : specRed ? 'openspec --strict failed' : 'chat eval hard-block',
    changeId,
    floor,
    specOk,
    evalVerdict,
    note: 'Fix and re-launch; the eval gate is capped at ONE run per invocation and is NOT re-run on loop-back.',
  }
}

// ------------------------------------------------------------------ Phase 5
phase('Review')
let reviewRound = 0
let review = await runReview()
if (review.failed) {
  return { bailed: true, phase: 'Review', reason: `greptile (forced default reviewer) could not produce a verified review: ${review.note || 'unavailable/unauth/stale'}. NOT degrading to cavecrew. Fix greptile auth/availability, or re-launch with reviewer='cavecrew' or 'greptile+cavecrew'.`, changeId, review, evalVerdict }
}

async function runGreptileVerified() {
  return agent(
    `You are the greptile reviewer. Mirror greptile's official cli-review preflight, then VERIFY the result matches THIS branch before returning findings:\n1. \`git rev-parse --show-toplevel\` and \`command -v greptile\`; if greptile is absent -> status "unavailable".\n2. \`greptile whoami\`; if unauthenticated -> status "unauth" (do NOT run \`greptile login\` — its browser OAuth is broken in this wrapped shell).\n3. Compute the review file set from the FORK POINT including uncommitted work: \`git diff ${DIFF_BASE}...HEAD --name-only\` (committed since the merge-base with ${DIFF_BASE}, NOT against the PR target) PLUS \`git status --porcelain\` (staged/unstaged/untracked). If this combined set is EMPTY while tasks.md shows implemented tasks, the work is uncommitted — return status "stale" (do NOT report a clean review of nothing; the caller will fall back to cavecrew on the working tree).\n4. Run \`greptile review -b ${DIFF_BASE} --json\` (fall back to \`--agent\` plain text if JSON fails). Time it.\n5. VERIFY: the review's referenced files must be a SUBSET of the branch diff file set. If they do NOT overlap, OR the review returned in under ~10s (a cache hit), it is a STALE / different-repo review — run it ONE more time fresh; if it still mismatches -> status "stale". Otherwise -> status "ok".\n6. Return status, elapsed_s, the review summary, the findings (severity/file/line/body), review_files, diff_files, and a note. Do NOT edit any code.`,
    { label: 'greptile-review', phase: 'Review', schema: GREPTILE_SCHEMA, agentType: 'general-purpose', ...CHEAP }
  )
}

async function triageGreptile(g) {
  const list = g.findings.map((f, i) => `${i + 1}. [${f.severity}] ${f.file}:${f.line ?? '?'} — ${f.body}`).join('\n')
  return agent(
    `Triage these greptile findings for OpenSpec change ${changeId} (greptile already reviewed the diff — you only ADJUDICATE, do not re-read the whole repo). For each: is it a REAL, blocking correctness/security/behavior defect, or a nit / false-positive / intent-conflict? Count confirmed_blocking = real blocking defects only. Never count style nits. Return confirmed_blocking, the findings list (with your one-line verdict each), and an overall verdict.\n\nGREPTILE SUMMARY: ${g.summary}\n\nFINDINGS:\n${list || '(none)'}`,
    { label: 'greptile-triage', phase: 'Review', schema: REVIEW_SCHEMA, agentType: 'general-purpose', ...CHEAP }
  )
}

async function runCavecrew() {
  const r = await agent(
    `Adversarially review the working-tree diff since the fork point — \`git diff $(git merge-base ${DIFF_BASE} HEAD)\` (this INCLUDES uncommitted changes) plus untracked files from \`git status --porcelain\` — for OpenSpec change ${changeId}. Hunt correctness + fail-open bugs + house-rule violations (inline comments in bodies, ticket tags, env-var gates). Return confirmed_blocking = count of CONFIRMED (not merely plausible) blocking defects, the findings, and a verdict.`,
    { label: 'review:cavecrew', phase: 'Review', schema: REVIEW_SCHEMA, agentType: 'caveman:cavecrew-reviewer', ...CODE }
  )
  return { confirmed: r ? r.confirmed_blocking : 0, reports: r ? [r] : [], source: 'cavecrew' }
}

async function runReview() {
  if (REVIEWER === 'cavecrew') return runCavecrew()
  const g = await runGreptileVerified()
  if (!g || g.status !== 'ok') {
    if (REVIEWER === 'greptile+cavecrew') {
      log(`greptile ${g ? g.status : 'error'} (${g ? g.note : ''}); using cavecrew (greptile+cavecrew mode)`)
      return runCavecrew()
    }
    log(`greptile ${g ? g.status : 'error'} (${g ? g.note : ''}) — FORCED greptile reviewer could not produce a verified review; NOT silently degrading to cavecrew`)
    return { confirmed: 0, reports: [], source: 'greptile', failed: true, note: g ? g.note : 'greptile call errored' }
  }
  const t = await triageGreptile(g)
  const base = { confirmed: t ? t.confirmed_blocking : 0, reports: t ? [t] : [], source: 'greptile', greptile: g }
  if (REVIEWER === 'greptile+cavecrew') {
    const cc = await runCavecrew()
    return { confirmed: base.confirmed + cc.confirmed, reports: [...base.reports, ...cc.reports], source: 'greptile+cavecrew', greptile: g }
  }
  return base
}

while (review.confirmed > 0 && reviewRound < MAX_REVIEW_LOOPBACKS) {
  reviewRound++
  log(`Review found ${review.confirmed} confirmed blocking finding(s) via ${review.source}; one bounded fix round.`)
  const fixFindings = review.reports.flatMap((r) => r.findings).join('\n')
  await agent(
    `Fix ONLY these CONFIRMED blocking review findings for change ${changeId}, then re-run the floor (ruff+pytest / pm test) and confirm green. Keep changes minimal and within the delta spec. Findings:\n${fixFindings}`,
    { label: `review-fix:${reviewRound}`, phase: 'Review', agentType: 'sdd-openspec', ...CODE }
  )
  review = await runReview()
}
if (review.confirmed > 0) {
  return { bailed: true, phase: 'Review', reason: `${review.confirmed} confirmed blocking finding(s) remain after ${MAX_REVIEW_LOOPBACKS} fix round(s)`, changeId, review, evalVerdict }
}
// A review-fix round mutated code — re-run the deterministic floor before Ship so a fix that broke
// tests can never reach the trunk (the fix agent's own self-report of green is not trusted here).
if (reviewRound > 0) {
  const refloor = await agent(RUN_FLOOR, { label: 'floor-postfix', phase: 'Review', schema: FLOOR_SCHEMA, agentType: 'general-purpose', ...CHEAP })
  if (!refloor || !refloor.passed) {
    return { bailed: true, phase: 'Review', reason: 'floor red after review-fix round — not shipping a fix that broke the build', changeId, refloor, review }
  }
}

// ------------------------------------------------------------------ Phase 6
phase('Ship')
const evidence = [
  `OpenSpec change: ${changeId}`,
  `Floor: ${floor && floor.passed ? 'green' : 'see logs'} | openspec --strict: ${specOk && specOk.passed ? 'pass' : 'see logs'}`,
  `Chat eval: ${evalVerdict.status}${evalVerdict.detail ? ' — ' + evalVerdict.detail : ''}`,
  `Review (${review.source}): clean after ${reviewRound} fix round(s)`,
].join('\n')

const ship = await agent(
  `Prepare the signed PR to the ${PR_TARGET} trunk for OpenSpec change ${changeId}. STRICT house rules:\n- HARD-GUARD, ABORT if any fails: you MUST be on a dedicated FEATURE branch — ABORT if the current branch IS '${PR_TARGET}' or any shared/protected branch (develop/testing/main); and \`git config commit.gpgsign\` must be true (NEVER --no-gpg-sign / --no-verify).\n- Ensure the correct gh account first: \`gh auth status\`.${GH_USER ? ` If the active account is not '${GH_USER}', run \`gh auth switch --user ${GH_USER}\`.` : ' Use whatever account is already authenticated — do NOT switch to any hardcoded user.'} (a wrong account -> push/PR 404 "Repository not found").\n- Only AFTER a successful signed commit, and only if tasks.md is fully checked ([x]), archive the change: \`openspec archive ${changeId} --yes\` (surface loudly if it fails; NEVER archive a change that still has unchecked tasks).\n- Create branch feature/<ticket-or-slug> if not already on a feature branch.\n- Commit SIGNED. The message MUST NOT contain any Claude/Anthropic co-author trailer or "Generated with Claude Code" footer.\n- ${AUTO_PR ? '\`git push\` (signed).' : 'Do NOT \`git push\` — leave the SIGNED commit LOCAL only.'}\n- ${AUTO_PR ? `Create the PR now: \`gh pr create --base ${PR_TARGET}\` with this evidence trail in the body.` : `Do NOT create the PR. Leave the SIGNED commit LOCAL (do not push) and RETURN both the push and \`gh pr create --base ${PR_TARGET} ...\` command (with the body) for the human to run.`}\n- NEVER merge ${PR_TARGET} into the feature branch.\n- In the PR/commit body include a "Known gaps / deviations from spec" section: list any deferred tasks, findings adjudicated out-of-scope, or design.md Open Questions still unconfirmed; write "none" if fully complete and clean.\n\nEvidence trail for the PR body:\n${evidence}\n\nReturn committed (true ONLY if a signed commit was actually created), branch, pr_url (null if not created), pr_command, the guard results, and detail.`,
  { label: 'ship', phase: 'Ship', schema: SHIP_SCHEMA, agentType: 'general-purpose', ...CHEAP }
)

if (!ship || !ship.committed) {
  return { bailed: true, phase: 'Ship', reason: ship ? `ship did not complete a signed commit: ${ship.detail || ship.guards || 'committed=false'}` : 'ship agent returned no result — failing closed', changeId, ship, review, evalVerdict }
}
return { bailed: false, changeId, brief, impl, floor, specOk, evalVerdict, review, ship, autoPr: AUTO_PR, prTarget: PR_TARGET, diffBase: DIFF_BASE, reviewer: REVIEWER }
