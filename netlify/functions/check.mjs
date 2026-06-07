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
//   GET  /api/check/<nonce>/<encodedUrls>   (path-based; <nonce> is ignored — it
//        only makes the path unique to defeat path-only upstream caches)

import { runChecks, formatResults } from './lib/check-core.mjs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Extra headers used ONLY for the path-based route, so the unique-per-request
// path is never cached anywhere.
const NO_CACHE = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  'Netlify-CDN-Cache-Control': 'no-store',
};

const json = (status, body, extra) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS, ...extra },
  body: JSON.stringify(body),
});

const textOut = (status, body, extra) => ({
  statusCode: status,
  headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...CORS, ...extra },
  body,
});

// Path-based route: /api/check/<nonce>/<encodedUrls>. Parse the ORIGINAL request
// path (rawUrl keeps percent-encoding intact; event.path is a decoded fallback),
// strip the nonce segment, then split + decode the comma-separated URL list.
// Returns null for the plain /api/check route, leaving its behaviour unchanged.
function pathUrlsFrom(event) {
  for (const candidate of [event.rawUrl, event.path]) {
    if (!candidate) continue;
    const pathOnly = String(candidate)
      .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, '') // strip scheme://host if present
      .split(/[?#]/)[0];
    const m = pathOnly.match(/\/api\/check\/[^/]+\/(.+)$/);
    if (!m) continue;
    const urls = m[1]
      .split(',')
      .map((s) => { try { return decodeURIComponent(s.trim()); } catch { return s.trim(); } })
      .filter(Boolean);
    if (urls.length) return urls;
  }
  return null;
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return json(405, { error: 'Use GET ?url= or POST { urls | items }.' });
  }

  const q = event.queryStringParameters || {};
  // ?format=md|text → a clean readable summary (for chat links / browsers).
  const asText = ['md', 'markdown', 'text'].includes(String(q.format || '').toLowerCase());

  // Path-based route only: send the uncache headers (existing routes unchanged).
  const pathUrls = pathUrlsFrom(event);
  const extra = pathUrls ? NO_CACHE : undefined;

  const input = {};
  if (pathUrls) {
    input.urls = pathUrls;
    if (q.baseUrl) input.baseUrl = q.baseUrl;
  } else if (event.httpMethod === 'POST' && event.body) {
    try { Object.assign(input, JSON.parse(event.body)); } catch { return json(400, { error: 'Invalid JSON body.' }, extra); }
  } else if (event.httpMethod === 'GET') {
    // Accept repeated ?url=… AND a single ?urls=… holding a comma / newline /
    // space-separated list (easier for a chat assistant to build one fetch).
    const list = [];
    if (q.url) list.push(...(Array.isArray(q.url) ? q.url : [q.url]));
    if (q.urls) list.push(...String(q.urls).split(/[\s,]+/));
    input.urls = list;
    if (q.baseUrl) input.baseUrl = q.baseUrl;
  }

  try {
    const out = await runChecks(input);
    return asText ? textOut(200, formatResults(out, { hops: true }), extra) : json(200, out, extra);
  } catch (e) {
    return asText ? textOut(e.status || 500, `Error: ${e.message}`, extra) : json(e.status || 500, { error: e.message }, extra);
  }
};

