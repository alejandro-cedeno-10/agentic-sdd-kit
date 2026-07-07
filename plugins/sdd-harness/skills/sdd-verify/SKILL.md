---
name: sdd-verify
description: Surface-aware end-to-end verification of a change — determine whether it touches a FRONTEND surface (rendered UI) or an API/backend surface, then validate the right way. Frontend → chrome-devtools MCP (open the affected page, screenshot, confirm it renders, check console/network/accessibility). API → a Playwright request script that hits the affected endpoints and asserts status + response shape. Use after implementing a change, or in the harness Validate step, to confirm it actually works in the running app — not just that unit tests pass. Requires the chrome-devtools-mcp plugin (frontend) and/or Playwright (API); both are wired up by the kit installer.
---

# Surface-aware verification

Unit tests prove the code does what its tests say; this skill proves the change works in the
running app. It picks the validation that matches what the change actually touches.

## 1. Detect the surface (from the diff)

Inspect `git diff` for the change:

- **Frontend** if it touches rendered UI: `.tsx/.jsx/.vue/.svelte/.html/.css/.scss`, component
  or page/route dirs, design tokens, a Storybook, etc.
- **API / backend** if it touches request handlers, routes, controllers, resolvers, an
  OpenAPI/Swagger spec, serializers, or lambda handlers.
- A change can be **both** — validate both surfaces.

If neither surface is present (pure lib/tooling/docs), say so and stop — there is nothing to
drive; the unit-test floor is the whole gate.

## 2. Frontend → chrome-devtools MCP

Requires the `chrome-devtools-mcp` plugin (load its tools via ToolSearch: `+chrome navigate`).

1. Start (or confirm) the dev server — read the project's run/dev script; do NOT assume a port.
2. `navigate_page` to the affected route(s).
3. `take_screenshot` — confirm the design renders (layout, the changed component, no obvious
   breakage). If the change has a reference design, compare against it.
4. `list_console_messages` — no new errors. `list_network_requests` — no failed calls for the
   view. Optionally run an accessibility/Lighthouse check on the affected page.
5. Report: rendered ✓/✗, console clean ✓/✗, network clean ✓/✗, with the screenshot as evidence.

## 3. API → Playwright request script

Requires Playwright (the kit installer confirms it; else `pnpm add -D @playwright/test`).

1. Identify the affected endpoints (method + path) from the diff and any OpenAPI delta.
2. Write a **throwaway** script under `scripts-dev/` (e.g. `api_smoke.spec.ts`) using
   Playwright's `request` context — NOT a browser:

   ```ts
   import { test, expect, request } from '@playwright/test'
   test('affected endpoint', async () => {
     const api = await request.newContext({ baseURL: process.env.BASE_API_URL })
     const res = await api.get('/the/affected/path')      // or .post(...) with a body
     expect(res.status()).toBe(200)
     expect(await res.json()).toMatchObject({ /* the shape the delta spec promises */ })
   })
   ```
3. Run it with THIS shell's own credentials/env (do not assume-role, do not widen IAM):
   `npx playwright test scripts-dev/api_smoke.spec.ts`.
4. Report status codes + shape assertions per endpoint; keep or delete the script per the repo's
   convention.

## When in the flow

The harness's Validate phase runs the deterministic floor (unit tests + `openspec --strict`); it
does NOT auto-drive a browser or an API. Invoke THIS skill yourself — or have the agent invoke it —
after implementing a change, or before approving a PR, to confirm the running surface actually
works. It stays a skill (not an automated gate) so the harness remains stack-agnostic.

## Rules

- Drive the REAL surface; a passing unit suite is not the same as "the page renders" or "the
  endpoint returns the promised shape".
- Never widen credentials/IAM to make a check pass — use the session's own environment.
- Throwaway API scripts live under `scripts-dev/`; never commit secrets into them.
