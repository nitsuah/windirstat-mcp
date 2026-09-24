/**
 * Shared Streamable HTTP transport for windirstat-mcp.
 *
 * One long-lived process serves any number of MCP clients (Claude Code
 * sessions, Claude Desktop, VS Code, ...). Each client gets its own MCP
 * session backed by its own Server instance, so clients never see each
 * other's JSON-RPC traffic.
 *
 * Lifecycle:
 * - sessionTtlMs: a session with no traffic for this long is closed. Lets
 *   clients that died without sending DELETE be reaped (0 = never).
 * - idleTimeoutMs: once there are zero sessions for this long, onIdle() is
 *   called, which by default exits the process (0 = never).
 */

import http from 'http';
import { randomUUID } from 'crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function sendJsonRpcError(res, status, code, message) {
  sendJson(res, status, { jsonrpc: '2.0', error: { code, message }, id: null });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// Only accept requests addressed to a loopback hostname. Guards against DNS
// rebinding: a malicious web page can reach 127.0.0.1 but not with a
// localhost Host header.
function isLocalHost(hostHeader) {
  if (!hostHeader) return false;
  const hostname = hostHeader.startsWith('[')
    ? hostHeader.slice(0, hostHeader.indexOf(']') + 1)
    : hostHeader.split(':')[0];
  return LOCAL_HOSTNAMES.has(hostname.toLowerCase());
}

export async function startHttpServer({
  createServer,
  host = '127.0.0.1',
  port = 3939,
  sessionTtlMs = 0,
  idleTimeoutMs = 0,
  onIdle = () => process.exit(0),
  log = (...args) => console.error('[http]', ...args)
}) {
  const sessions = new Map(); // sessionId -> { transport, lastSeen }
  let idleTimer = null;

  function cancelIdle() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function scheduleIdle() {
    if (!idleTimeoutMs || sessions.size > 0 || idleTimer) return;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (sessions.size > 0) return;
      log(`No sessions for ${Math.round(idleTimeoutMs / 1000)}s, shutting down`);
      httpServer.close();
      onIdle();
    }, idleTimeoutMs);
  }

  const reaper = sessionTtlMs
    ? setInterval(() => {
      const now = Date.now();
      for (const [id, session] of sessions) {
        if (now - session.lastSeen > sessionTtlMs) {
          log(`Reaping stale session ${id}`);
          session.transport.close().catch(() => {});
        }
      }
    }, Math.min(sessionTtlMs, 60 * 1000))
    : null;
  reaper?.unref();

  async function createSession(req, res, body) {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (id) => {
        sessions.set(id, { transport, lastSeen: Date.now() });
        cancelIdle();
        log(`Session opened ${id} (${sessions.size} active)`);
      }
    });
    transport.onclose = () => {
      const id = transport.sessionId;
      if (id && sessions.delete(id)) {
        log(`Session closed ${id} (${sessions.size} active)`);
        scheduleIdle();
      }
    };
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  async function handle(req, res) {
    if (!isLocalHost(req.headers.host)) {
      return sendJsonRpcError(res, 403, -32000, 'Forbidden: non-local Host header');
    }

    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === '/health') {
      return sendJson(res, 200, { status: 'ok', sessions: sessions.size });
    }
    if (pathname !== '/mcp') {
      return sendJson(res, 404, { error: 'Not found' });
    }

    let body;
    if (req.method === 'POST') {
      try {
        body = await readJsonBody(req);
      } catch (e) {
        return sendJsonRpcError(res, 400, -32700, `Parse error: ${e.message}`);
      }
    }

    const sessionId = req.headers['mcp-session-id'];
    if (sessionId) {
      const session = sessions.get(sessionId);
      if (!session) {
        // Per spec, clients must start a new session on 404.
        return sendJsonRpcError(res, 404, -32001, 'Session not found');
      }
      session.lastSeen = Date.now();
      return session.transport.handleRequest(req, res, body);
    }

    if (req.method === 'POST' && isInitializeRequest(body)) {
      return createSession(req, res, body);
    }

    return sendJsonRpcError(res, 400, -32000, 'Bad Request: missing session ID');
  }

  const httpServer = http.createServer((req, res) => {
    handle(req, res).catch(err => {
      log('Request failed:', err);
      if (!res.headersSent) sendJsonRpcError(res, 500, -32603, 'Internal error');
    });
  });

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, resolve);
  });

  // Start the idle countdown immediately so a server nobody connects to
  // still goes away.
  scheduleIdle();

  return {
    httpServer,
    sessions,
    port: httpServer.address().port,
    async close() {
      cancelIdle();
      if (reaper) clearInterval(reaper);
      await Promise.all([...sessions.values()].map(s => s.transport.close().catch(() => {})));
      await new Promise(resolve => httpServer.close(() => resolve()));
    }
  };
}
