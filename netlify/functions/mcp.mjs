// Remote MCP server over Streamable HTTP — lets Claude.ai chat add this as a
// "custom connector" (Settings → Connectors). Stateless: every JSON-RPC POST is
// handled independently and answered with application/json (no sessions, no SSE,
// no server-initiated messages), which fits a serverless function cleanly.
//
// Exposes one tool, `check_redirects`, backed by the shared engine core.
// Spec: https://modelcontextprotocol.io (Streamable HTTP transport).

import { runChecks, formatResults, MAX } from './lib/check-core.mjs';

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'redirect-sentinel', version: '1.0.0' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Mcp-Session-Id, MCP-Protocol-Version, Authorization',
};

const CHECK_TOOL = {
  name: 'check_redirects',
  description:
    'Audit HTTP redirects against an AEM + Akamai setup. Traces each source URL ' +
    'hop-by-hop (status, server/edge tag, timing) and, when an expected target is ' +
    'given, returns a STRICT pass/fail contract verdict (PASS / FAIL / BLOCKED). ' +
    `Handles up to ${MAX} URLs per call. Use "items" for source/expected contract ` +
    'checks, or "urls" to just trace chains.',
  inputSchema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description: 'Source/expected pairs for a strict contract check.',
        items: {
          type: 'object',
          properties: {
            source: { type: 'string', description: 'Source URL to trace.' },
            expected: { type: 'string', description: 'Expected final URL (strict exact match decides PASS/FAIL).' },
            ruleName: { type: 'string', description: 'Optional label carried into the result.' },
          },
          required: ['source'],
        },
      },
      urls: {
        type: 'array',
        description: 'Plain list of source URLs to trace (no expected-target comparison).',
        items: { type: 'string' },
      },
      baseUrl: { type: 'string', description: 'Optional base to resolve relative source/expected paths.' },
    },
  },
};

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

async function callTool(params) {
  if (!params || params.name !== 'check_redirects') {
    return { content: [{ type: 'text', text: `Unknown tool: ${params?.name}` }], isError: true };
  }
  try {
    const a = params.arguments || {};
    const out = await runChecks({ items: a.items, urls: a.urls, baseUrl: a.baseUrl });
    const text = `${formatResults(out)}\n\n\`\`\`json\n${JSON.stringify(out, null, 2)}\n\`\`\``;
    return { content: [{ type: 'text', text }] };
  } catch (e) {
    return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
  }
}

// Handle one JSON-RPC message. Returns a response object, or null for
// notifications (which get no reply).
async function handleMessage(msg) {
  const { id, method, params } = msg || {};
  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize':
      return rpcResult(id, {
        protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: [CHECK_TOOL] });
    case 'tools/call':
      return rpcResult(id, await callTool(params));
    default:
      // Notifications (e.g. notifications/initialized) need no response.
      if (isNotification) return null;
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', ...CORS },
  body: JSON.stringify(body),
});

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  // No SSE / server-initiated stream in this stateless server.
  if (event.httpMethod === 'GET') return { statusCode: 405, headers: { ...CORS, Allow: 'POST, OPTIONS' }, body: '' };
  if (event.httpMethod !== 'POST') return json(405, rpcError(null, -32600, 'Method not allowed'));

  let payload;
  try {
    payload = JSON.parse(event.body || '');
  } catch {
    return json(400, rpcError(null, -32700, 'Parse error'));
  }

  // Single message or a JSON-RPC batch.
  if (Array.isArray(payload)) {
    const responses = (await Promise.all(payload.map(handleMessage))).filter(Boolean);
    if (!responses.length) return { statusCode: 202, headers: CORS, body: '' }; // all notifications
    return json(200, responses);
  }

  const response = await handleMessage(payload);
  if (!response) return { statusCode: 202, headers: CORS, body: '' }; // notification
  return json(200, response);
};
