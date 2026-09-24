import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const INDEX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.js');

let child;
let base;
let sessionId;
let tmpDir;
let nextId = 1;

async function rpc(method, params) {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {})
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params })
  });
  sessionId ??= res.headers.get('mcp-session-id');
  return (await res.json()).result;
}

const callTool = (name, args) => rpc('tools/call', { name, arguments: args });

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wds-tools-'));
  fs.writeFileSync(path.join(tmpDir, 'small.txt'), 'a'.repeat(100));
  fs.writeFileSync(path.join(tmpDir, 'big.txt'), 'b'.repeat(5000));
  fs.writeFileSync(path.join(tmpDir, 'mid.txt'), 'c'.repeat(1000));

  const port = 40000 + Math.floor(Math.random() * 20000);
  child = spawn(process.execPath, [INDEX], {
    env: { ...process.env, MCP_TRANSPORT: 'http', MCP_PORT: String(port) },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  await new Promise((resolve, reject) => {
    child.stderr.on('data', d => { if (String(d).includes('running on http')) resolve(); });
    child.on('exit', code => reject(new Error(`server exited with ${code}`)));
  });
  base = `http://127.0.0.1:${port}`;
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'vitest', version: '0' } });
}, 20000);

afterAll(() => {
  child?.kill();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('tool handlers', () => {
  it('scan_directory honours minSizeMB: 0 and sorts by exact size', async () => {
    const result = await callTool('scan_directory', { path: tmpDir, minSizeMB: 0 });
    const { items } = JSON.parse(result.content[0].text);
    expect(items.map(i => i.name)).toEqual(['big.txt', 'mid.txt', 'small.txt']);
  });

  it('get_largest_items sorts by exact size and respects limit', async () => {
    const result = await callTool('get_largest_items', { path: tmpDir, limit: 2 });
    const { topItems } = JSON.parse(result.content[0].text);
    expect(topItems.map(i => i.name)).toEqual(['big.txt', 'mid.txt']);
  });

  it('flags a missing path as an error', async () => {
    const result = await callTool('scan_directory', { path: path.join(tmpDir, 'nope') });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^Path not found/);
  });

  it('flags a file passed as a directory as an error', async () => {
    const result = await callTool('categorize_safety_tiers', { path: path.join(tmpDir, 'big.txt') });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^Not a directory/);
  });

  it('rejects invalid numeric arguments', async () => {
    expect((await callTool('get_largest_items', { path: tmpDir, limit: 0 })).isError).toBe(true);
    expect((await callTool('scan_directory', { path: tmpDir, maxDepth: -1 })).isError).toBe(true);
  });

  it('clean_safe_targets rejects non-array targets without touching disk', async () => {
    const result = await callTool('clean_safe_targets', { targets: tmpDir, confirmAction: true });
    expect(result.isError).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'big.txt'))).toBe(true);
  });
});
