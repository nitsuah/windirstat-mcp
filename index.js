import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load configuration
function loadConfig() {
  const configPath = path.join(__dirname, 'config.default.json');
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }
  return {};
}

const config = loadConfig();
const PROTECTED_KEYWORDS = config.protectedKeywords || [
  'code project',
  'freelance',
  'downloads\\apk',
  'documents\\backup',
  'system32',
  'windows',
  'program files',
  'boot',
  '.git',
  'node_modules',
  '.vscode',
  '.idea'
];

const WINDOWS_SYSTEM_PATHS = config.windowsSystemPaths || [
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\ProgramData',
  'C:\\$Recycle.Bin',
  'C:\\System Volume Information',
  'C:\\Recovery',
  'C:\\PerfLogs'
];

const TIER1_KEYWORDS = config.tier1Keywords || [
  'temp',
  'cache',
  'crashdump',
  'updater',
  '.tmp',
  '.log'
];

const TIER2_KEYWORDS = config.tier2Keywords || [
  'download',
  '.zip',
  '.rar',
  '.exe',
  '.msi',
  '.xapk',
  '.iso'
];

const WINDOWS_TEMP_PATHS = config.windowsTempPaths || [
  '%TEMP%',
  '%TMP%',
  '%USERPROFILE%\\AppData\\Local\\Temp',
  '%USERPROFILE%\\AppData\\Local\\Microsoft\\Windows\\INetCache',
  '%USERPROFILE%\\AppData\\Local\\Microsoft\\Windows\\Temporary Internet Files',
  '%SYSTEMROOT%\\Temp',
  '%SYSTEMROOT%\\Prefetch',
  'C:\\Windows\\Temp',
  'C:\\Windows\\Prefetch'
];

// Expand Windows environment variables
function expandWindowsEnvVars(p) {
  return p
    .replace(/%TEMP%/gi, process.env.TEMP || '')
    .replace(/%TMP%/gi, process.env.TMP || '')
    .replace(/%USERPROFILE%/gi, process.env.USERPROFILE || '')
    .replace(/%SYSTEMROOT%/gi, process.env.SYSTEMROOT || 'C:\\Windows');
}

function getExpandedWindowsTempPaths() {
  return WINDOWS_TEMP_PATHS.map(expandWindowsEnvVars).filter(Boolean);
}

function isProtected(targetPath) {
  // Split a normalized path string into its individual components
  function pathComponents(p) {
    return p.split(/[\\/]/).filter(Boolean);
  }

  function matchesKeyword(p) {
    const lower = p.toLowerCase();
    const components = pathComponents(lower);
    return PROTECTED_KEYWORDS.some(kw => {
      const kwLower = kw.toLowerCase();
      // Multi-segment keywords (contain path separator or space) use substring match
      if (/[\\/\s]/.test(kwLower)) {
        return lower.includes(kwLower);
      }
      // Single-component keywords must match an exact path segment
      return components.includes(kwLower);
    });
  }

  // Check if path is a Windows system path
  function isWindowsSystemPath(p) {
    const lower = p.toLowerCase();
    return WINDOWS_SYSTEM_PATHS.some(sysPath => {
      const sysLower = sysPath.toLowerCase();
      return lower === sysLower || lower.startsWith(sysLower + '\\') || lower.startsWith(sysLower + '/');
    });
  }

  // Check if path is in Windows temp paths
  function isWindowsTempPath(p) {
    const lower = p.toLowerCase();
    return getExpandedWindowsTempPaths().some(tempPath => {
      const tempLower = tempPath.toLowerCase();
      return lower === tempLower || lower.startsWith(tempLower + '\\') || lower.startsWith(tempLower + '/');
    });
  }

  try {
    const resolvedPath = fs.realpathSync(path.resolve(targetPath)).toLowerCase();

    // Check Windows system paths first (highest protection)
    if (isWindowsSystemPath(resolvedPath)) {
      return true;
    }

    // Check Windows temp paths (lowest protection - safe to clean)
    if (isWindowsTempPath(resolvedPath)) {
      return false; // Explicitly NOT protected - these are safe temp paths
    }

    return matchesKeyword(resolvedPath);
  } catch (e) {
    if (e.code !== 'ENOENT') {
      return true;
    }

    // If path doesn't exist, fall back to basic check on normalized path
    const normalizedPath = path.resolve(targetPath).toLowerCase();

    if (isWindowsSystemPath(normalizedPath)) {
      return true;
    }

    if (isWindowsTempPath(normalizedPath)) {
      return false;
    }

    return matchesKeyword(normalizedPath);
  }
}

function getFolderSize(dirPath, currentDepth = 0, maxDepth = 3) {
  let totalSize = 0;
  let fileCount = 0;
  let lastModified = new Date(0);

  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dirPath, item.name);
      try {
        if (item.isDirectory()) {
          if (currentDepth < maxDepth) {
            const sub = getFolderSize(fullPath, currentDepth + 1, maxDepth);
            totalSize += sub.totalSize;
            fileCount += sub.fileCount;
            if (sub.lastModified > lastModified) lastModified = sub.lastModified;
          }
        } else if (item.isFile()) {
          const stats = fs.statSync(fullPath);
          totalSize += stats.size;
          fileCount++;
          if (stats.mtime > lastModified) lastModified = stats.mtime;
        }
      } catch (e) {
        // Silently skip locked files
      }
    }
  } catch (e) {
    // Silently skip inaccessible dirs
  }

  return { totalSize, fileCount, lastModified };
}

const server = new Server(
  {
    name: 'windirstat-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'scan_directory',
        description: 'Deep scan a directory and return subdirectories sorted by storage size in MB/GB with file counts.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Absolute directory path to scan' },
            maxDepth: { type: 'number', description: 'Depth to recurse (default 2)' },
            minSizeMB: { type: 'number', description: 'Minimum size threshold in MB (default 50)' }
          },
          required: ['path']
        }
      },
      {
        name: 'get_largest_items',
        description: 'Find top N largest files and subfolders under a specific path.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Absolute directory path to inspect' },
            limit: { type: 'number', description: 'Number of top items to return (default 15)' }
          },
          required: ['path']
        }
      },
      {
        name: 'categorize_safety_tiers',
        description: 'Categorize directory items into Tier 1 (100% Safe Cache/Temp), Tier 2 (Reviewable Downloads/Media), and Tier 3 (Protected Code/Projects).',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Absolute directory path to categorize' }
          },
          required: ['path']
        }
      },
      {
        name: 'clean_safe_targets',
        description: 'Safely delete specified temporary cache folders or files with built-in protection guards. Use reportOnly: true to simulate without deleting.',
        inputSchema: {
          type: 'object',
          properties: {
            targets: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of absolute file or directory paths to clean'
            },
            confirmAction: { type: 'boolean', description: 'Must be true to execute deletion' },
            reportOnly: { type: 'boolean', description: 'If true, only report what would be deleted without performing deletion' }
          },
          required: ['targets', 'confirmAction']
        }
      },
      {
        name: 'visualize_directory',
        description: 'Generate ASCII treemap visualization of directory sizes (WinDirStat-style 2D treemap in terminal).',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Absolute directory path to visualize' },
            maxDepth: { type: 'number', description: 'Depth to recurse (default 3)' },
            width: { type: 'number', description: 'Terminal width for visualization (default 80)' },
            minSizeMB: { type: 'number', description: 'Minimum size in MB to display (default 10)' }
          },
          required: ['path']
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === 'scan_directory') {
      const dirPath = args.path;
      const maxDepth = args.maxDepth || 2;
      const minSizeMB = args.minSizeMB || 50;

      if (!fs.existsSync(dirPath)) {
        return { content: [{ type: 'text', text: `Directory not found: ${dirPath}` }] };
      }

      const items = fs.readdirSync(dirPath, { withFileTypes: true });
      const results = [];

      for (const item of items) {
        const fullPath = path.join(dirPath, item.name);
        let sizeBytes = 0;
        let fileCount = 0;
        let lastMod = new Date(0);

        if (item.isDirectory()) {
          const res = getFolderSize(fullPath, 0, maxDepth);
          sizeBytes = res.totalSize;
          fileCount = res.fileCount;
          lastMod = res.lastModified;
        } else if (item.isFile()) {
          try {
            const stats = fs.statSync(fullPath);
            sizeBytes = stats.size;
            fileCount = 1;
            lastMod = stats.mtime;
          } catch (e) {}
        }

        const sizeMB = Number((sizeBytes / (1024 * 1024)).toFixed(2));
        const sizeGB = Number((sizeBytes / (1024 * 1024 * 1024)).toFixed(2));

        if (sizeMB >= minSizeMB) {
          results.push({
            name: item.name,
            path: fullPath,
            sizeMB,
            sizeGB,
            fileCount,
            lastModified: lastMod.toISOString().split('T')[0],
            isDir: item.isDirectory()
          });
        }
      }

      results.sort((a, b) => b.sizeMB - a.sizeMB);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ target: dirPath, count: results.length, items: results }, null, 2)
        }]
      };
    }

    if (name === 'get_largest_items') {
      const dirPath = args.path;
      const limit = args.limit || 15;

      if (!fs.existsSync(dirPath)) {
        return { content: [{ type: 'text', text: `Path not found: ${dirPath}` }] };
      }

      const items = fs.readdirSync(dirPath, { withFileTypes: true });
      const results = [];

      for (const item of items) {
        const fullPath = path.join(dirPath, item.name);
        let sizeBytes = 0;
        let fileCount = 0;

        if (item.isDirectory()) {
          const res = getFolderSize(fullPath, 0, 3);
          sizeBytes = res.totalSize;
          fileCount = res.fileCount;
        } else if (item.isFile()) {
          try {
            const stats = fs.statSync(fullPath);
            sizeBytes = stats.size;
            fileCount = 1;
          } catch (e) {}
        }

        results.push({
          name: item.name,
          path: fullPath,
          sizeMB: Number((sizeBytes / (1024 * 1024)).toFixed(2)),
          sizeGB: Number((sizeBytes / (1024 * 1024 * 1024)).toFixed(2)),
          fileCount,
          type: item.isDirectory() ? 'directory' : 'file'
        });
      }

      results.sort((a, b) => b.sizeMB - a.sizeMB);
      const topItems = results.slice(0, limit);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ target: dirPath, topItems }, null, 2)
        }]
      };
    }

    if (name === 'categorize_safety_tiers') {
      const dirPath = args.path;

      if (!fs.existsSync(dirPath)) {
        return { content: [{ type: 'text', text: `Path not found: ${dirPath}` }] };
      }

      const items = fs.readdirSync(dirPath, { withFileTypes: true });
      const tier1 = [];
      const tier2 = [];
      const tier3 = [];

      for (const item of items) {
        const fullPath = path.join(dirPath, item.name);
        const lowerName = item.name.toLowerCase();
        let sizeBytes = 0;

        if (item.isDirectory()) {
          sizeBytes = getFolderSize(fullPath, 0, 2).totalSize;
        } else {
          try { sizeBytes = fs.statSync(fullPath).size; } catch(e){}
        }

        const info = {
          name: item.name,
          path: fullPath,
          sizeMB: Number((sizeBytes / (1024 * 1024)).toFixed(2)),
          sizeGB: Number((sizeBytes / (1024 * 1024 * 1024)).toFixed(2))
        };

        if (isProtected(fullPath)) {
          tier3.push({ ...info, reason: 'Protected Code/Project/System Data' });
        } else if (
          lowerName.includes('temp') ||
          lowerName.includes('cache') ||
          lowerName.includes('crashdump') ||
          lowerName.includes('updater') ||
          lowerName.endsWith('.tmp') ||
          lowerName.endsWith('.log')
        ) {
          tier1.push({ ...info, reason: '100% Safe Cache / Temporary Files' });
        } else if (
          lowerName.includes('download') ||
          lowerName.endsWith('.zip') ||
          lowerName.endsWith('.rar') ||
          lowerName.endsWith('.exe') ||
          lowerName.endsWith('.msi') ||
          lowerName.endsWith('.xapk') ||
          lowerName.endsWith('.iso')
        ) {
          tier2.push({ ...info, reason: 'Reviewable Media / Downloads / Installers' });
        } else {
          tier2.push({ ...info, reason: 'User Data / Unclassified' });
        }
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ target: dirPath, tier1_safe: tier1, tier2_reviewable: tier2, tier3_protected: tier3 }, null, 2)
        }]
      };
    }

    if (name === 'clean_safe_targets') {
      const { targets, confirmAction, reportOnly } = args;

      if (!confirmAction) {
        return { content: [{ type: 'text', text: 'Error: confirmAction must be true to proceed with deletion.' }] };
      }

      const results = [];
      let totalFreedBytes = 0;

      for (const targetPath of targets) {
        try {
          const requestedPath = path.resolve(targetPath);
          let deletePath = requestedPath;

          try {
            deletePath = fs.realpathSync(requestedPath);
          } catch (err) {
            if (err.code === 'ENOENT') {
              if (isProtected(targetPath)) {
                results.push({ path: targetPath, status: reportOnly ? 'WOULD_SKIP_PROTECTED' : 'SKIPPED_PROTECTED', freedMB: 0 });
              } else {
                results.push({ path: targetPath, status: 'NOT_FOUND', freedMB: 0 });
              }
              continue;
            }

            throw err;
          }

          if (isProtected(deletePath)) {
            results.push({ path: targetPath, status: reportOnly ? 'WOULD_SKIP_PROTECTED' : 'SKIPPED_PROTECTED', freedMB: 0 });
            continue;
          }

          const stats = fs.statSync(deletePath);
          let sizeBytes = 0;

          if (stats.isDirectory()) {
            sizeBytes = getFolderSize(deletePath, 0, 5).totalSize;
            if (!reportOnly) {
              fs.rmSync(deletePath, { recursive: true, force: true });
            }
          } else {
            sizeBytes = stats.size;
            if (!reportOnly) {
              fs.unlinkSync(deletePath);
            }
          }

          totalFreedBytes += sizeBytes;
          results.push({
            path: targetPath,
            status: reportOnly ? 'WOULD_DELETE' : 'DELETED_SUCCESSFULLY',
            freedMB: Number((sizeBytes / (1024 * 1024)).toFixed(2)),
            freedGB: Number((sizeBytes / (1024 * 1024 * 1024)).toFixed(2))
          });
        } catch (err) {
          results.push({ path: targetPath, status: `ERROR: ${err.message}`, freedMB: 0 });
        }
      }

      const totalFreedGB = Number((totalFreedBytes / (1024 * 1024 * 1024)).toFixed(2));

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ totalFreedGB, details: results, mode: reportOnly ? 'REPORT_ONLY' : 'EXECUTE' }, null, 2)
        }]
      };
    }

    if (name === 'visualize_directory') {
      const dirPath = args.path;
      const maxDepth = args.maxDepth ?? 3;
      const width = args.width ?? 80;
      const minSizeMB = args.minSizeMB ?? 10;

      if (!Number.isFinite(maxDepth) || maxDepth < 0 || maxDepth > 20) {
        return { content: [{ type: 'text', text: 'Error: maxDepth must be a finite number between 0 and 20.' }] };
      }
      if (!Number.isFinite(width) || width < 40 || width > 300) {
        return { content: [{ type: 'text', text: 'Error: width must be a finite number between 40 and 300.' }] };
      }
      if (!Number.isFinite(minSizeMB) || minSizeMB < 0) {
        return { content: [{ type: 'text', text: 'Error: minSizeMB must be a finite number >= 0.' }] };
      }

      if (!fs.existsSync(dirPath)) {
        return { content: [{ type: 'text', text: `Path not found: ${dirPath}` }] };
      }
      if (!fs.statSync(dirPath).isDirectory()) {
        return { content: [{ type: 'text', text: `Not a directory: ${dirPath}` }] };
      }

      let items;
      try {
        items = fs.readdirSync(dirPath, { withFileTypes: true });
      } catch (e) {
        return { content: [{ type: 'text', text: `Error reading directory: ${e.message}` }] };
      }

      const results = [];
      const minSizeBytes = minSizeMB * 1024 * 1024;

      for (const item of items) {
        const fullPath = path.join(dirPath, item.name);
        let sizeBytes = 0;
        let fileCount = 0;

        if (item.isDirectory()) {
          const res = getFolderSize(fullPath, 0, maxDepth);
          sizeBytes = res.totalSize;
          fileCount = res.fileCount;
        } else if (item.isFile()) {
          try {
            const stats = fs.statSync(fullPath);
            sizeBytes = stats.size;
            fileCount = 1;
          } catch (e) {}
        }

        if (sizeBytes >= minSizeBytes) {
          results.push({
            name: item.name,
            path: fullPath,
            sizeMB: Number((sizeBytes / (1024 * 1024)).toFixed(2)),
            sizeBytes,
            fileCount,
            isDir: item.isDirectory()
          });
        }
      }

      results.sort((a, b) => b.sizeBytes - a.sizeBytes);

      const totalSize = results.reduce((sum, r) => sum + r.sizeBytes, 0);

      // Fixed (non-bar) columns in each item row: "│ " + icon + " " + name(30) + " " + bar + " " + size(10) + " " + pct(3) + "% │"
      const NAME_WIDTH = 30;
      const SIZE_WIDTH = 10;
      const PCT_WIDTH = 3;
      const ICON_WIDTH = 2; // emoji occupy 2 UTF-16 code units
      const ROW_FIXED_WIDTH = '│ '.length + ICON_WIDTH + ' '.length + NAME_WIDTH + ' '.length + ' '.length + SIZE_WIDTH + ' '.length + PCT_WIDTH + '% │'.length;
      const totalRowWidth = Math.max(ROW_FIXED_WIDTH + 20, width);
      const visualWidth = totalRowWidth - ROW_FIXED_WIDTH;
      const borderWidth = totalRowWidth - 2; // width between the ┌/├/└ and ┐/┤/┘ corners

      let output = `\n┌─ ${path.basename(dirPath)} ─┐\n`;
      output += `│ Total: ${Number((totalSize / (1024 * 1024)).toFixed(1))} MB (${results.length} items) │\n`;
      output += `├${'─'.repeat(borderWidth)}┤\n`;

      for (const item of results.slice(0, 20)) {
        const pct = totalSize > 0 ? Math.round((item.sizeBytes / totalSize) * 100) : 0;
        const barLen = Math.max(1, Math.round((item.sizeBytes / totalSize) * visualWidth));
        const bar = '█'.repeat(barLen);
        const sizeStr = item.sizeMB >= 1024
          ? `${Number((item.sizeMB / 1024).toFixed(1))} GB`
          : `${item.sizeMB} MB`;
        const typeIcon = item.isDir ? '📁' : '📄';
        output += `│ ${typeIcon} ${item.name.padEnd(NAME_WIDTH).slice(0, NAME_WIDTH)} ${bar.padEnd(visualWidth)} ${sizeStr.padStart(SIZE_WIDTH)} ${pct.toString().padStart(PCT_WIDTH)}% │\n`;
      }

      if (results.length > 20) {
        const moreText = `... and ${results.length - 20} more items`;
        output += `│ ${moreText.padEnd(borderWidth - 2)} │\n`;
      }

      output += `└${'─'.repeat(borderWidth)}┘\n`;

      return {
        content: [{
          type: 'text',
          text: output
        }]
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true
    };
  }
});

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('WinDirStat MCP Server running on stdio');
}

runServer().catch(console.error);
