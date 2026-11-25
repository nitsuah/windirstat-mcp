# TASKS

> 🧭 [windirstat-mcp](../README.md) · [Features](./FEATURES.md) · [Roadmap](./ROADMAP.md) · **Tasks** · [Changelog](./CHANGELOG.md) <!-- nav -->

Last Updated: 2026-11-24

GitHub Issues are disabled on this repo, so this file is the backlog.

## Done

- [x] Vitest suite and CI plan: tests for utils, path mapping, tool handlers and the HTTP server/bridge; CI runs `npm run test:coverage` on every PR (`test/`, `.github/workflows/ci.yml`).
- [x] Docker image plus CI smoke test of the stdio startup message.
- [x] Shared-container HTTP transport and the `mcp-server.js` bridge.
- [x] Dependabot for npm and GitHub Actions; explicit workflow permissions for CodeQL.
- [x] Standards docs: FEATURES, ROADMAP, TASKS, CHANGELOG and `promo/spots.json`.

## In Progress

## Todo

### P2 - Medium

- [ ] Tag a release. `package.json` says 1.0.0 but no git tag exists, so the changelog cannot link versions.
  - Acceptance Criteria: a `v1.0.0` tag and a changelog section for it.
- [x] Update `package.json` metadata: the `author` field says "Antigravity AI" and there is no `repository` or `homepage` field.
- [x] Allow a user config override. `loadConfig()` only reads `config.default.json` beside `index.js`, so changing protected keywords means editing the shipped file (or the image).
  - Acceptance Criteria: an optional `WINDIRSTAT_MCP_CONFIG` path merged over the defaults, with a test and a README note.

### P3 - Exploratory

- [ ] Split `index.js` (about 650 lines holding all five tool handlers) into per-tool modules under `lib/`.
- [ ] Add a lint step (ESLint) to CI; none exists today.
- [ ] Capture for promo: generated visuals (a `visualize_directory` output for a fixture folder, a `clean_safe_targets` report-only run) for the no-frontend spots.
