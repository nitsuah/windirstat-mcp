# Changelog

> 🧭 [windirstat-mcp](../README.md) · [Features](./FEATURES.md) · [Roadmap](./ROADMAP.md) · [Tasks](./TASKS.md) · **Changelog** <!-- nav -->

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
No version has been tagged yet (`package.json` says 1.0.0), so history below is grouped by month.

## [Unreleased]

### Added

- `WINDIRSTAT_MCP_CONFIG`: an optional JSON file merged key by key over `config.default.json` (new `lib/config.js`, with tests), so protected keywords can be tuned without editing the shipped defaults. A missing or invalid override file is an error at start-up.
- `docs/` standards set: FEATURES, ROADMAP, TASKS and this changelog, plus `promo/spots.json`.

## 2026-11

### Changed

- `package.json`: `author` is now the maintainer, and `repository` and `homepage` are set.
- Dependency bumps: hono, `@hono/node-server`, and the minor-and-patch group (#30-#35).

### Fixed

- Explicit least-privilege `permissions` on the CI workflow to clear a CodeQL alert (#29).

## 2026-10

### Changed

- Coordinated Vitest 5 and `@vitest/coverage-v8` 5 upgrade (#28); `@hono/node-server` 2.x (#27); updates to zod, hono, the MCP SDK and the Actions pins, plus transitive security bumps (body-parser, ip-address, fast-uri, proxy-addr, brace-expansion, source-map-js).

## 2026-09

### Added

- One shared container for all MCP clients: HTTP transport at `/mcp` with a `/health` endpoint, per-client sessions, `docker-compose.yml`, and the `mcp-server.js` bridge (#10).
- Container lifecycle management: idle spin-down, container reuse and auto-cleanup (#9).

### Fixed

- Windows paths are accepted and mapped in Docker mode, and messages are held until the session exists (#11).
- Tool argument defaults, error flags and sort order (#12).
- `categorizeItem` matches tier-1 keywords as an exact name or extension, not a substring (#8).

## 2026-08

### Added

- `visualize_directory`, a config file (`config.default.json`), Windows temp-path handling, a Vitest suite and CI (#7).
- Dockerfile.
- `reportOnly` mode for `clean_safe_targets` (#2).
- Initial release of the WinDirStat MCP server with `scan_directory`, `get_largest_items`, `categorize_safety_tiers` and `clean_safe_targets` (2026-07-24).

### Security

- Protection checks use canonical path resolution, the target is revalidated before deletion, and protected keywords match whole path components only (#5, #6).
