// check — SYNCHRONOUS redirect check API (CLAUDE.md §6 verdict model).
//
// Unlike /api/audit (async background job → archive → poll), this returns
// results INLINE in the HTTP response, so any non-browser client can use it:
// curl, a script, the Claude API with tool-use, or an MCP server. No login, no
// archival, no Playwright fallback.
//
//   POST /api/check   { "urls": ["https://a/...", ...] }
//   POST /api/check   { "items": [{ "source": "...", "expected": "...", "ruleName": "..." }], "baseUrl": "..." }
//   GET  /api/check?url=https://a/...&url=https://b/...
//
// Capped at the anonymous tier (10 URLs). Because sync functions are bounded to
// ~10s, we use tight per-hop timeouts, a low hop cap and no retries — fast for
// normal redirect chains; pathologically slow/looping targets should go through
// the full /api/audit flow instead.

import { trace } from './lib/engine.mjs';
import { runBatched } from './lib/batch.mjs';
import { classify } from './lib/verdict.mjs';
import { summarise } from './lib/report.mjs';
import { ANON_LIMIT } from './lib/auth.mjs';

const MAX = ANON_LIMIT; // 10
const TRACE_OPTS = { perHopTimeoutMs: 4000, maxHops: 6, maxRetries: 0 };

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

function abs(value, baseUrl) {
  const v = value == null ? '' : String(value).trim();
  if (!v) return null;
  try { return new URL(v, baseUrl || undefined).toString(); } catch { return null; }
}

// Normalise the various input shapes into a flat item list.
function buildItems(input, query) {
  const baseUrl = input.baseUrl || process.env.DEFAULT_BASE_URL || '';
  if (Array.isArray(input.items)) {
    return input.items.map((it) => ({
      ruleName: it.ruleName || '',
      source: abs(it.source, baseUrl) || String(it.source || ''),
      expected: it.expected ? (abs(it.expected, baseUrl) || String(it.expected)) : null,
    }));
  }
  let urls = Array.isArray(input.urls) ? input.urls : [];
  if (!urls.length && query && query.url) urls = Array.isArray(query.url) ? query.url : [query.url];
  return urls.map((u) => String(u).trim()).filter(Boolean).map((u) => ({
    ruleName: '', source: abs(u, baseUrl) || u, expected: null,
  }));
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return json(405, { error: 'Use GET ?url= or POST { urls | items }.' });
  }

  let input = {};
  if (event.httpMethod === 'POST' && event.body) {
    try { input = JSON.parse(event.body); } catch { return json(400, { error: 'Invalid JSON body.' }); }
  }

  const items = buildItems(input, event.queryStringParameters || {});
  if (!items.length) return json(400, { error: 'Provide "urls": [...] or "items": [{source, expected}] (or ?url=).' });
  if (items.length > MAX) {
    return json(413, { error: `This endpoint is capped at ${MAX} URLs per call. For larger sets use the app's audit flow (/api/audit).` });
  }

  const results = await runBatched(
    items,
    async (item) => {
      if (!item.source || !/^https?:/i.test(item.source)) {
        return { ...item, trace: { finalUrl: null, finalStatus: null, hopCount: 0, blocked: false, loop: false, inconclusive: false, error: 'invalid URL — provide a full https:// URL', hops: [] } };
      }
      return { ...item, trace: await trace(item.source, TRACE_OPTS) };
    },
    {
      // ≤10 URLs: run them promptly but keep the adaptive back-off in play.
      concurrency: 5, startInFlight: 8, maxInFlight: 10, batchSize: 30, cooldownMs: 2000,
      assess: (r) => (r && r.trace && (r.trace.blocked || r.trace.inconclusive) ? 'blocked' : 'ok'),
    },
  );

  const rows = results.map((r) => {
    const t = r.trace;
    const { verdict, reason } = classify({
      expected: r.expected, finalUrl: t.finalUrl, finalStatus: t.finalStatus,
      hopCount: t.hopCount, blocked: t.blocked, loop: t.loop, inconclusive: t.inconclusive, error: t.error,
    });
    return {
      ruleName: r.ruleName, source: r.source, expected: r.expected,
      finalUrl: t.finalUrl, finalStatus: t.finalStatus, hopCount: t.hopCount,
      verdict, reason, error: t.error,
      hops: (t.hops || []).map((h) => ({ url: h.url, status: h.status, server: h.server, location: h.location, timeMs: h.timeMs })),
    };
  });

  return json(200, { count: rows.length, summary: summarise(rows), results: rows });
};
