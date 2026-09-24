import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { startHttpServer } from '../lib/http-server.js';

const BRIDGE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'mcp-server.js');

function createServer() {
  const server = new Server({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{ name: 'noop', description: 'noop', inputSchema: { type: 'object', properties: {} } }]
  }));
  return server;
}

const initialize = (id = 1) => ({
  jsonrpc: '2.0',
  id,
  method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'vitest', version: '0' } }
});

async function rpc(base, body, sessionId, extraHeaders = {}) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...extraHeaders };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  const res = await fetch(`${base}/mcp`, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  return { res, body: text ? JSON.parse(text) : null, sessionId: res.headers.get('mcp-session-id') };
}

async function openSession(base) {
  const { sessionId } = await rpc(base, initialize());
  await rpc(base, { jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId);
  return sessionId;
}

const health = async base => (await fetch(`${base}/health`)).json();

let running = [];
async function start(opts = {}) {
  const srv = await startHttpServer({ createServer, port: 0, log: () => {}, onIdle: () => {}, ...opts });
  running.push(srv);
  return { srv, base: `http://127.0.0.1:${srv.port}` };
}

afterEach(async () => {
  await Promise.all(running.map(s => s.close()));
  running = [];
});

describe('startHttpServer', () => {
  it('gives each client its own session on one shared server', async () => {
    const { base } = await start();
    const a = await openSession(base);
    const b = await openSession(base);

    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
    expect(await health(base)).toEqual({ status: 'ok', sessions: 2 });

    const { body } = await rpc(base, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, a);
    expect(body.result.tools.map(t => t.name)).toEqual(['noop']);
  });

  it('returns 404 for unknown sessions so clients re-initialize', async () => {
    const { base } = await start();
    const { res } = await rpc(base, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'nope');
    expect(res.status).toBe(404);
  });

  it('rejects non-initialize requests without a session', async () => {
    const { base } = await start();
    const { res } = await rpc(base, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).toBe(400);
  });

  it('rejects requests with a non-local Host header (DNS rebinding)', async () => {
    const { srv } = await start();
    const http = await import('http');
    const status = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: srv.port, path: '/health', headers: { Host: 'evil.example:80' } },
        res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(403);
  });

  it('closes a session on DELETE and fires onIdle once no sessions remain', async () => {
    let idled = 0;
    const { base } = await start({ idleTimeoutMs: 50, onIdle: () => { idled++; } });
    const id = await openSession(base);

    await new Promise(r => setTimeout(r, 100));
    expect(idled).toBe(0); // an active session keeps the server up

    await fetch(`${base}/mcp`, { method: 'DELETE', headers: { 'Mcp-Session-Id': id } });
    expect((await health(base)).sessions).toBe(0);

    await new Promise(r => setTimeout(r, 150));
    expect(idled).toBe(1);
  });

  it('reaps sessions whose client went silent', async () => {
    const { base } = await start({ sessionTtlMs: 50 });
    await openSession(base);
    expect((await health(base)).sessions).toBe(1);

    await new Promise(r => setTimeout(r, 200));
    expect((await health(base)).sessions).toBe(0);
  });
});

describe('mcp-server.js bridge', () => {
  function startBridge(base) {
    const child = spawn(process.execPath, [BRIDGE], {
      env: { ...process.env, WINDIRSTAT_MCP_URL: `${base}/mcp` },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const replies = [];
    const waiters = [];
    readline.createInterface({ input: child.stdout }).on('line', line => {
      const msg = JSON.parse(line);
      replies.push(msg);
      waiters.splice(0).forEach(w => w());
    });
    const send = msg => child.stdin.write(JSON.stringify(msg) + '\n');
    const reply = async id => {
      for (;;) {
        const found = replies.find(r => r.id === id);
        if (found) return found;
        await new Promise(r => waiters.push(r));
      }
    };
    const exited = new Promise(r => child.on('exit', r));
    return { child, send, reply, exited };
  }

  it('holds messages pipelined behind initialize until the session exists', async () => {
    const { base } = await start();
    const bridge = startBridge(base);

    bridge.send(initialize(1));
    bridge.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    bridge.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });

    expect((await bridge.reply(2)).result.tools).toHaveLength(1);
    expect((await health(base)).sessions).toBe(1);

    bridge.child.stdin.end();
    expect(await bridge.exited).toBe(0);
  }, 15000);

  it('relays stdio, recovers a lost session, and closes its session on exit', async () => {
    const { srv, base } = await start();
    const bridge = startBridge(base);

    bridge.send(initialize(1));
    expect((await bridge.reply(1)).result.serverInfo.name).toBe('test');
    bridge.send({ jsonrpc: '2.0', method: 'notifications/initialized' });

    bridge.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect((await bridge.reply(2)).result.tools).toHaveLength(1);
    expect((await health(base)).sessions).toBe(1);

    // Simulate the server dropping the session (restart / TTL reap).
    await Promise.all([...srv.sessions.values()].map(s => s.transport.close()));
    expect((await health(base)).sessions).toBe(0);

    bridge.send({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
    expect((await bridge.reply(3)).result.tools).toHaveLength(1);
    expect((await health(base)).sessions).toBe(1);

    // Client goes away: the bridge must release its session.
    bridge.child.stdin.end();
    expect(await bridge.exited).toBe(0);
    expect((await health(base)).sessions).toBe(0);
  }, 15000);
});
