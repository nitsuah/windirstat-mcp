import fs from 'fs';
import path from 'path';

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    throw new Error(`Cannot read ${label} at ${file}: ${err.message}`);
  }
}

/**
 * Load the shipped defaults from `config.default.json` in `baseDir`, then
 * shallow-merge an optional user override over them. The override file is the
 * path in `WINDIRSTAT_MCP_CONFIG`; each top-level key it sets replaces the
 * default for that key. A missing default file yields `{}`; a missing or
 * invalid override file throws so a typo never silently falls back to defaults.
 */
export function loadConfig(baseDir, env = process.env) {
  const defaultPath = path.join(baseDir, 'config.default.json');
  const base = fs.existsSync(defaultPath) ? readJson(defaultPath, 'default config') : {};
  const overridePath = env.WINDIRSTAT_MCP_CONFIG;
  if (!overridePath) return base;
  const override = readJson(overridePath, 'WINDIRSTAT_MCP_CONFIG');
  if (override === null || typeof override !== 'object' || Array.isArray(override)) {
    throw new Error(`WINDIRSTAT_MCP_CONFIG at ${overridePath} must contain a JSON object`);
  }
  return { ...base, ...override };
}
