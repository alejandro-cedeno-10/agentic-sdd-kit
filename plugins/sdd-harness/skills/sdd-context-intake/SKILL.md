---
name: sdd-context-intake
description: Ingest raw context the user pastes or points at — a ticket, a design doc, meeting notes, a spec, a URL, referenced files/paths — and have an agent READ and UNDERSTAND all of it, then synthesize a well-formed feature brief (goal, scope, constraints, and load-bearing unknowns) that feeds sdd-clarify and the sdd-feature-flow harness. Use at the very start of a feature when you have source material instead of a one-line goal, or whenever the user says "here's the context" / "read this" / dumps a ticket or doc.
---

# Context intake for Spec-Driven Development

The user rarely starts with a clean one-line goal — they have a ticket, a doc, a thread,
some files. This skill turns that raw material into the structured brief the SDD flow
needs, WITHOUT guessing past what the sources actually say.

## When to use

- The user pastes a ticket / requirements / design doc / notes and says "do this".
- The user names files, paths, or URLs as the source of truth.
- Before `sdd-clarify` and before launching `sdd-feature-flow`, when the goal is buried in
  material rather than stated.

## Procedure

1. **Collect every source the user gave**, verbatim: pasted text, plus anything referenced —
   `Read` the named files, `WebFetch` the URLs, pull the ticket via its MCP/CLI if available.
   Do NOT stop at the pasted blurb if it points elsewhere.
2. **Delegate the reading when it's large or multi-source.** Spawn a read-only agent (the
   `Explore` or `general-purpose` agent) to ingest the sources and return a compact digest —
   this keeps the bulky material out of the main context. For a single short paste, read inline.
3. **Synthesize a brief** with exactly these sections, grounded ONLY in the sources (mark
   anything you inferred):
   - **Goal** — one or two lines: what to build and why (the "what/why", not the "how").
   - **In scope / Out of scope** — bullet lists drawn from the sources.
   - **Constraints** — data model, contracts, integrations, naming, limits the sources state.
   - **Load-bearing unknowns** — decisions the sources do NOT settle that would change code,
     contract, or template structure. These become the questions for `sdd-clarify`.
   - **Sources** — the files/URLs/tickets you actually read.
4. **Hand off.** Feed the unknowns to `sdd-clarify` (ask the user), then pass the resolved
   brief as the `goal` (and any confirmed params) to the `sdd-feature-flow` workflow.

## Rules

- Ground everything in the sources. If the source doesn't say it, it's an **unknown**, not an
  assumption — surface it, don't invent it. (This is the same discipline the harness's clarity
  gate enforces later; catching it here is cheaper.)
- Never begin writing a spec or code from this skill — its only output is the brief.
- Keep the digest tight; the point is to compress source material into decisions and unknowns.
