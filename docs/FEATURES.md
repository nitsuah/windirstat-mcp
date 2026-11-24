# Features

> 🧭 [windirstat-mcp](../README.md) · **Features** · [Roadmap](./ROADMAP.md) · [Tasks](./TASKS.md) · [Changelog](./CHANGELOG.md) <!-- nav -->

An MCP server for Windows disk analysis and safe cleanup. Every item below is checked against `index.js`, `lib/` and `mcp-server.js`.

## Tools

- **`scan_directory`** - Scans a directory and returns each entry with its size in MB/GB, file count and last-modified date, largest first. Inputs: `path`, `maxDepth` (default 2, 0-20), `minSizeMB` (default 50).
- **`get_largest_items`** - Ranks the top N largest files and subfolders under a path. Inputs: `path`, `limit` (default 15, positive integer).
- **`categorize_safety_tiers`** - Sorts the entries of a directory into Tier 1 (safe cache/temp), Tier 2 (reviewable downloads/media) and Tier 3 (protected code, projects and system data).
- **`clean_safe_targets`** - Deletes the given files or folders. Requires `confirmAction: true`, skips protected paths, and `reportOnly: true` simulates the run (`WOULD_DELETE` / `WOULD_SKIP_PROTECTED`) without deleting.
- **`visualize_directory`** - Draws a WinDirStat-style ASCII chart of a directory's top-level contents with bars proportional to size. Inputs: `path`, `maxDepth` (default 3, 0-20), `width` (default 80, 40-300), `minSizeMB` (default 10).

## Safety

- **Protected-path guard** - Paths are resolved to their canonical real path before the check and again before deletion, then matched against a Windows system-path list (`C:\Windows`, `C:\Program Files`, ...) and protected keywords (`.git`, `node_modules`, `system32`, ...). Keywords match whole path components, never substrings.
- **Known temp locations stay cleanable** - `%TEMP%`, `%TMP%`, INetCache, Prefetch and the Windows temp folders are checked first, so they are not blocked by the broader `C:\Windows` rule.
- **Explicit confirmation** - Deletion never runs without `confirmAction: true`; invalid arguments return an `isError` result instead of throwing.
- **Local-only HTTP** - The HTTP transport rejects requests whose `Host` header is not `localhost`, `127.0.0.1` or `[::1]` (DNS-rebinding guard), and compose publishes the port on `127.0.0.1` only.

## Configuration

- **`config.default.json`** - Tunes `protectedKeywords`, `windowsSystemPaths`, `tier1Keywords`, `tier2Keywords`, `windowsTempPaths` and the `visualization` defaults; built-in defaults apply for any missing key.

## Transports and deployment

- **stdio** - `node index.js`, for Claude Desktop, Cursor, VS Code and similar clients.
- **Streamable HTTP** - `node index.js --http` (or `MCP_TRANSPORT=http`) serves `/mcp` and `/health`, one MCP session per client.
- **Shared Docker container** - `docker compose up` (always on) or the `mcp-server.js` stdio-to-HTTP bridge (starts or reuses one `windirstat-mcp-server` container, drops idle sessions and exits after an idle timeout) so many clients share one container.
- **Windows path mapping** - In Docker, `C:\...` paths are translated into the read-only `/host-c` mount and mapped back in results (`SCAN_ROOT`, `HOST_ROOT`, `HOST_MOUNT`).

## Quality

- **Vitest suite** - Unit and handler tests for utils, path mapping, the tools and the HTTP server/bridge, with v8 coverage.
- **CI** - GitHub Actions runs the tests with coverage on every PR and, on `main`, builds the image and smoke-tests that it starts on stdio.
- **Dependabot** - Weekly npm and GitHub Actions updates.
