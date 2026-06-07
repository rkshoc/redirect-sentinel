// check — SYNCHRONOUS redirect check API (CLAUDE.md §6 verdict model).
//
// Unlike /api/audit (async background job → archive → poll), this returns
// results INLINE in the HTTP response, so any non-browser client can use it:
// curl, a script, the Claude API with tool-use, or an MCP server. No login, no
// archival, no Playwright fallback. Shared logic lives in lib/check-core.mjs.
//
//   POST /api/check   { "urls": ["https://a/...", ...] }
//   POST /api/check   { "items": [{ "source": "...", "expected": "...", "ruleName": "..." }], "baseUrl": "..." }
//   GET  /api/check?url=https://a/...&url=https://b/...

import { runChecks, formatResults } from './lib/check-core.mjs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS },
  body: JSON.stringify(body),
});

const textOut = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...CORS },
  body,
});

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return json(405, { error: 'Use GET ?url= or POST { urls | items }.' });
  }

  const q = event.queryStringParameters || {};
  // ?format=md|text → a clean readable summary (for chat links / browsers).
  const asText = ['md', 'markdown', 'text'].includes(String(q.format || '').toLowerCase());

  const input = {};
  if (event.httpMethod === 'POST' && event.body) {
    try { Object.assign(input, JSON.parse(event.body)); } catch { return json(400, { error: 'Invalid JSON body.' }); }
  } else if (event.httpMethod === 'GET') {
    if (q.url) input.urls = Array.isArray(q.url) ? q.url : [q.url];
    if (q.baseUrl) input.baseUrl = q.baseUrl;
  }

  try {
    const out = await runChecks(input);
    return asText ? textOut(200, formatResults(out, { hops: true })) : json(200, out);
  } catch (e) {
    return asText ? textOut(e.status || 500, `Error: ${e.message}`) : json(e.status || 500, { error: e.message });
  }
};

