# ensure-openspec.ps1
# pnpm-only policy: ensure @fission-ai/openspec is installed globally via pnpm
# whenever a session starts inside an OpenSpec project. Silent no-op otherwise.
# Wired as a SessionStart hook in ~/.claude/settings.json.

$ErrorActionPreference = 'SilentlyContinue'

# Only act inside an OpenSpec project (cwd has openspec/config.yaml).
if (-not (Test-Path (Join-Path (Get-Location) 'openspec/config.yaml'))) { exit 0 }

# Already installed -> nothing to do.
if (Get-Command openspec -ErrorAction SilentlyContinue) { exit 0 }

# pnpm is THE package manager. If missing, try to bring it up via corepack.
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  if (Get-Command corepack -ErrorAction SilentlyContinue) {
    corepack enable *> $null
    corepack prepare pnpm@latest --activate *> $null
  }
}

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Write-Output '{"systemMessage":"OpenSpec project detected but openspec CLI and pnpm are both missing. Enable pnpm (corepack enable) then run: pnpm add -g @fission-ai/openspec"}'
  exit 0
}

# Install via pnpm only (never npm/npx).
pnpm add -g '@fission-ai/openspec' *> $null

if (Get-Command openspec -ErrorAction SilentlyContinue) {
  Write-Output '{"systemMessage":"Installed @fission-ai/openspec globally via pnpm (was missing). Use openspec / pnpm openspec, not npx."}'
}
exit 0
