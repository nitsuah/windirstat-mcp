#!/usr/bin/env node
/**
 * windirstat-mcp shared-container bridge (stdio <-> HTTP)
 *
 * MCP clients that only speak stdio (or that should auto-start the server)
 * launch this script instead of `docker run`. It:
 *   1. Makes sure exactly one `windirstat-mcp-server` container is running
 *      (reusing it if another client already started it; building the image
 *      only if it is missing).
 *   2. Opens its own MCP session on the container's Streamable HTTP endpoint
 *      and relays JSON-RPC between stdio and HTTP.
 *   3. Sends a heartbeat so its session stays alive, and closes the session
 *      when the client goes away.
 *
 * The container stops itself once no sessions remain for MCP_IDLE_TIMEOUT_MS,
 * so N clients share one container and zero clients means zero containers.
 *
 * Zero dependencies on purpose: runs with plain `node` on the host.
 *
 * Env:
 *   WINDIRSTAT_MCP_URL   Connect to this endpoint and skip Docker management
 *   MCP_PORT             Host port for the shared container (default 3939)
 *   SCAN_ROOT            Host dir mounted read-only at /host-c (default C:/)
 *   MCP_IDLE_TIMEOUT_MS  Container exits after this long with no sessions (default 10 min)
 *   MCP_SESSION_TTL_MS   Container reaps sessions silent for this long (default 5 min)
 */

import { spawnSync } from 'child_process';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const IMAGE_NAME = 'windirstat-mcp';
const CONTAINER_NAME = 'windirstat-mcp-server';
const PROJECT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.MCP_PORT) || 3939;
const MANAGE_DOCKER = !process.env.WINDIRSTAT_MCP_URL;
const MCP_URL = process.env.WINDIRSTAT_MCP_URL || `http://127.0.0.1:${PORT}/mcp`;
const HEALTH_URL = new URL('/health', MCP_URL).href;
// Docker's -v spec expects forward slashes even on Windows
const SCAN_ROOT = (process.env.SCAN_ROOT || 'C:/').replace(/\\/g, '/');
const IDLE_TIMEOUT_MS = Number(process.env.MCP_IDLE_TIMEOUT_MS) || 10 * 60 * 1000;
const SESSION_TTL_MS = Number(process.env.MCP_SESSION_TTL_MS) || 5 * 60 * 1000;
const HEARTBEAT_MS = Math.min(60 * 1000, SESSION_TTL_MS / 3);
const STARTUP_TIMEOUT_MS = 60 * 1000;

let sessionId = null;
let protocolVersion = null;
let initMessage = null; // replayed to transparently recover a lost session
let recovering = null;
let pingCounter = 0;

function log(...args) {
  console.error('[mcp-bridge]', ...args);
}

function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', stdio: 'pipe', shell: false });
  if (result.error) {
    throw new Error(`docker ${args[0]} failed to run: ${result.error.message}`);
  }
  return result;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function healthy() {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

function startContainer() {
  if (docker(['image', 'inspect', IMAGE_NAME]).status !== 0) {
    log(`Image ${IMAGE_NAME} not found, building...`);
    const build = docker(['build', '-t', IMAGE_NAME, PROJECT_DIR]);
    if (build.status !== 0) throw new Error(`docker build failed: ${build.stderr}`);
  }

  log(`Starting shared container ${CONTAINER_NAME}...`);
  const run = docker([
    'run', '-d', '--rm', '--init',
    '--name', CONTAINER_NAME,
    '-p', `127.0.0.1:${PORT}:3939`,
    '-v', `${SCAN_ROOT}:/host-c:ro`,
    '-e', 'MCP_TRANSPORT=http',
    '-e', 'MCP_HOST=0.0.0.0',
    '-e', `MCP_IDLE_TIMEOUT_MS=${IDLE_TIMEOUT_MS}`,
    '-e', `MCP_SESSION_TTL_MS=${SESSION_TTL_MS}`,
    IMAGE_NAME
  ]);
  // A name conflict means another client won the race (or the old container
  // is still shutting down); either way keep polling until healthy.
  if (run.status !== 0 && !/already in use/i.test(run.stderr)) {
    log(`docker run failed: ${run.stderr.trim()}`);
  }
}

async function ensureServer() {
  if (await healthy()) return;
  if (!MANAGE_DOCKER) throw new Error(`MCP server at ${MCP_URL} is not reachable`);

  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const running = docker(['ps', '-q', '--filter', `name=^${CONTAINER_NAME}$`]).stdout.trim();
    if (!running) startContainer();
    await sleep(500);
    if (await healthy()) return;
  }
  throw new Error(`Timed out waiting for ${CONTAINER_NAME} on port ${PORT}`);
}

function writeMessage(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function parseSse(text) {
  return text.split(/\r?\n\r?\n/)
    .map(event => event.split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart())
      .join('\n'))
    .filter(Boolean)
    .map(data => JSON.parse(data));
}

class SessionLostError extends Error {}

async function post(msg) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream'
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  if (protocolVersion) headers['Mcp-Protocol-Version'] = protocolVersion;

  const res = await fetch(MCP_URL, { method: 'POST', headers, body: JSON.stringify(msg) });
  if (res.status === 404 && sessionId) throw new SessionLostError();
  if (!res.ok) {
    // Error bodies carry `id: null`, which the client can't match to its
    // request; throw so handleMessage answers with the original id.
    let detail = `HTTP ${res.status}`;
    try {
      detail = JSON.parse(await res.text()).error?.message ?? detail;
    } catch {
      // Non-JSON error body; keep the status code.
    }
    throw new Error(detail);
  }

  const newSessionId = res.headers.get('mcp-session-id');
  if (newSessionId) sessionId = newSessionId;

  const text = await res.text();
  if (!text) return [];
  const contentType = res.headers.get('content-type') || '';
  const payload = contentType.includes('text/event-stream') ? parseSse(text) : JSON.parse(text);
  return Array.isArray(payload) ? payload : [payload];
}

// The container restarted (idle timeout, crash, manual stop): bring it back
// and replay the client's original handshake so the client never notices.
function recoverSession() {
  recovering ??= (async () => {
    log('Session lost, re-establishing...');
    sessionId = null;
    await ensureServer();
    await post({ ...initMessage, id: 'bridge-reinit' });
    await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  })().finally(() => { recovering = null; });
  return recovering;
}

async function forward(msg) {
  if (recovering) await recovering;
  const usedSessionId = sessionId;
  try {
    return await post(msg);
  } catch (err) {
    // Only recover from a lost session (404) or an unreachable container
    // (fetch rejects with TypeError); anything else is a real error.
    const lost = err instanceof SessionLostError || err instanceof TypeError;
    if (!lost || !initMessage || msg === initMessage) throw err;
    // A stale failure from a session that was already replaced must not
    // trigger a second recovery (which would orphan the replacement).
    if (sessionId === usedSessionId) {
      await recoverSession();
    } else if (recovering) {
      await recovering;
    }
    return post(msg);
  }
}

async function handleMessage(msg) {
  const isRequest = msg.id !== undefined && msg.method !== undefined;
  try {
    if (msg.method === 'initialize') {
      await ensureServer();
      initMessage = msg;
    }
    const replies = await forward(msg);
    for (const reply of replies) {
      if (msg.method === 'initialize' && reply.result?.protocolVersion) {
        protocolVersion = reply.result.protocolVersion;
      }
      writeMessage(reply);
    }
  } catch (err) {
    log(`Failed to relay ${msg.method ?? 'message'}: ${err.message}`);
    if (isRequest) {
      writeMessage({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: `windirstat-mcp bridge: ${err.message}` } });
    }
  }
}

async function heartbeat() {
  if (!sessionId || recovering) return;
  try {
    await forward({ jsonrpc: '2.0', id: `bridge-ping-${++pingCounter}`, method: 'ping' });
  } catch (err) {
    log(`Heartbeat failed: ${err.message}`);
  }
}

let shuttingDown = false;
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (sessionId) {
    try {
      await fetch(MCP_URL, {
        method: 'DELETE',
        headers: { 'Mcp-Session-Id': sessionId },
        signal: AbortSignal.timeout(2000)
      });
    } catch {
      // Server already gone; its session TTL covers this case anyway.
    }
  }
  process.exit(code);
}

function main() {
  setInterval(heartbeat, HEARTBEAT_MS).unref();

  const rl = readline.createInterface({ input: process.stdin });
  const pending = new Set();
  rl.on('line', line => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      log('Ignoring non-JSON input line');
      return;
    }
    const p = handleMessage(msg);
    pending.add(p);
    p.finally(() => pending.delete(p));
  });
  // Client closed our stdin: flush in-flight replies, then end the session.
  rl.on('close', async () => {
    await Promise.allSettled([...pending]);
    shutdown(0);
  });

  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.once(sig, () => shutdown(0));
  }
}

main();
