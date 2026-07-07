---
name: sdd-checklist
description: Generate a requirements-quality checklist for an OpenSpec change and run it against the proposal/design/tasks/delta — validating completeness, clarity, consistency, and testability BEFORE you approve the spec. Modeled on GitHub Spec-Kit's /checklist. Use when reviewing a spec at the human approval gate, or before launching implementation, to catch under-specified requirements early.
---

# Requirements quality checklist

`--strict` validation proves a spec is well-FORMED; it doesn't prove it's well-SPECIFIED.
This skill generates a tailored checklist and grades the change against it, so gaps in
clarity or coverage surface before code — not in review.

## When to use

- At the `sdd-feature-flow` human approval gate, to decide whether to approve the spec.
- Before `/opsx:apply` or launching implementation on any non-trivial change.

## Procedure

1. **Read the change**: `openspec/changes/<id>/proposal.md`, `design.md`, `tasks.md`, and the
   delta spec(s); plus `openspec/project.md` (the constitution) if present.
2. **Generate the checklist**, tailored to what this change touches. Cover at least:
   - **Completeness** — is every stated requirement addressed by the design AND the tasks?
     Are error/empty/edge cases specified, not just the happy path? Are non-goals explicit?
   - **Clarity** — is each requirement testable and unambiguous (SHALL/MUST, concrete values)?
     Any "should probably / TBD / etc." that hides a real decision?
   - **Consistency** — do proposal, design, tasks and delta agree? Any contradiction in scope,
     data model, or naming? Does anything violate the constitution?
   - **Testability** — does each requirement have a scenario or a task that would fail if the
     requirement were unmet? Is the verification path concrete?
   - **Assumptions** — is every load-bearing assumption either confirmed or flagged as an open
     question (NOT silently baked in)?
3. **Grade each item** pass / fail / n-a with a one-line reason, and list the fails first.
4. **Recommend**: approve as-is, approve with the listed fixes, or send back for revision.

## Output

A compact table (item · verdict · reason), fails first, then a one-line recommendation.
Read-only — this skill changes no files; it produces the checklist and the verdict.
