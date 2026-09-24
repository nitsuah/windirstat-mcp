# WinDirStat MCP Server 🧹📊

Model Context Protocol (MCP) Server for real-time Windows storage analysis, deep folder scanning, safety tiering, and protected cleanup operations.

## Features & Exposed Tools

1. **`scan_directory`**
   - Deep scans a folder and returns all items with size (MB/GB), file counts, and last write dates.
2. **`get_largest_items`**
   - Ranks the top N largest files and subdirectories for any target path.
3. **`categorize_safety_tiers`**
   - Categorizes files/folders into **Tier 1 (100% Safe Cache/Temp)**, **Tier 2 (Reviewable Downloads/Media)**, and **Tier 3 (Protected Code/Projects)**.
4. **`clean_safe_targets`**
   - Cleans temporary caches and specified paths with built-in protection guards preventing accidental deletion of project repositories.
5. **`visualize_directory`**
   - Renders a WinDirStat-style ASCII treemap of a directory's top-level contents in the terminal, with proportional bars sized by disk usage.
   - Inputs: `path` (required, directory to visualize), `maxDepth` (recursion depth for subfolder sizing, default `3`, 0-20), `width` (terminal width for the chart, default `80`, 40-300), `minSizeMB` (minimum size in MB for an item to be shown, default `10`, >= 0).

---

## Configuration / Installation

### 1. Claude Desktop Integration (`claude_desktop_config.json`)

Add the following entry to your `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "windirstat": {
      "command": "node",
      "args": [
        "C:\\path\\to\\windirstat-mcp\\index.js"
      ]
    }
  }
}
```

### 2. Antigravity IDE / Cursor / VS Code Integration

Add to your MCP settings configuration:

```json
{
  "mcpServers": {
    "windirstat": {
      "command": "node",
      "args": [
        "C:/path/to/windirstat-mcp/index.js"
      ]
    }
  }
}
```

### 3. Docker: one shared instance for every client

Plain `docker run --rm -i windirstat-mcp` in an MCP config starts a **new container for every client session** (each Claude Code session, each VS Code window, ...). To share one container instead, run the server in HTTP mode. Each client still gets its own MCP session inside the shared container.

**Option A: auto start/stop (recommended).** Point every client at the bridge script. It starts the shared `windirstat-mcp-server` container if nothing is running yet, or reuses the one that is. The container removes itself after 10 minutes with no connected clients. Requires `node` on the host (no npm install needed).

```json
{
  "mcpServers": {
    "windirstat-mcp": {
      "command": "node",
      "args": ["C:/path/to/windirstat-mcp/mcp-server.js"]
    }
  }
}
```

**Option B: always on.** Run `npm run docker:up` (docker compose, `restart: unless-stopped`) and connect clients over HTTP:

```json
{ "mcpServers": { "windirstat-mcp": { "type": "http", "url": "http://127.0.0.1:3939/mcp" } } }
```

Both options use the same container name and port, so they never run side by side. The host directory `SCAN_ROOT` (default `C:/`) is mounted read-only at `/host-c`. Clients keep using normal Windows paths (`C:\Users\<you>`): the server maps them into the mount and maps result paths back. Paths outside `SCAN_ROOT` are not visible to the container.

| Env var | Default | Meaning |
|---|---|---|
| `MCP_TRANSPORT` | `stdio` | `http` serves Streamable HTTP at `/mcp` (same as `--http`) |
| `MCP_PORT` | `3939` | HTTP port |
| `MCP_IDLE_TIMEOUT_MS` | `0` (bridge: 10 min) | Exit once no sessions remain for this long; `0` = never |
| `MCP_SESSION_TTL_MS` | `0` (bridge: 5 min) | Drop sessions with no traffic for this long; the bridge heartbeats to stay alive |
| `SCAN_ROOT` | `C:/` | Host directory mounted read-only at `/host-c` |
| `HOST_ROOT` / `HOST_MOUNT` | unset / `/host-c` | Server side: translate Windows paths under `HOST_ROOT` to and from `HOST_MOUNT` (set automatically by the bridge and compose) |
| `WINDIRSTAT_MCP_URL` | | Bridge only: connect to this URL and skip Docker management |
