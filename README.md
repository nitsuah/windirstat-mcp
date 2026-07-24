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
        "C:\\Users\\Hariz\\windirstat-mcp\\index.js"
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
        "C:/Users/Hariz/windirstat-mcp/index.js"
      ]
    }
  }
}
```
