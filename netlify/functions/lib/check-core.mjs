// Shared redirect-check core — used by both the HTTP API (check.mjs) and the
// remote MCP endpoint (mcp.mjs) so there's a single code path and one cap.
//
// Capped at the anonymous tier (10 URLs). Sync-friendly trace settings (tight
// per-hop timeout, low hop cap, no retries) keep callers within the ~10s
// function budget; large audits belong in the async /api/audit flow.

import { trace } from './engine.mjs';
import { runBatched } from './batch.mjs';
import { classify } from './verdict.mjs';
import { summarise } from './report.mjs';
import { ANON_LIMIT } from './auth.mjs';

export const MAX = ANON_LIMIT; // 10
const TRACE_OPTS = { perHopTimeoutMs: 4000, maxHops: 6, maxRetries: 0 };

function abs(value, baseUrl) {
  const v = value == null ? '' : String(value).trim();
  if (!v) return null;
  try { return new URL(v, baseUrl || undefined).toString(); } catch { return null; }
}

// Normalise { items } or { urls } (+ optional baseUrl) into a flat item list.
export function buildItems(input = {}) {
  const baseUrl = input.baseUrl || process.env.DEFAULT_BASE_URL || '';
  if (Array.isArray(input.items)) {
    return input.items.map((it) => ({
      ruleName: it.ruleName || '',
      source: abs(it.source, baseUrl) || String(it.source || ''),
      expected: it.expected ? (abs(it.expected, baseUrl) || String(it.expected)) : null,
    }));
  }
  const urls = Array.isArray(input.urls) ? input.urls : [];
  return urls.map((u) => String(u).trim()).filter(Boolean).map((u) => ({
    ruleName: '', source: abs(u, baseUrl) || u, expected: null,
  }));
}

// Run the checks. Throws Error with a `.status` on validation failure.
export async function runChecks(input = {}) {
  const items = buildItems(input);
  if (!items.length) {
    throw Object.assign(new Error('Provide "urls": [...] or "items": [{ source, expected? }].'), { status: 400 });
  }
  if (items.length > MAX) {
    throw Object.assign(new Error(`Capped at ${MAX} URLs per call. For larger sets use the app's audit flow (/api/audit).`), { status: 413 });
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

  return { count: rows.length, summary: summarise(rows), results: rows };
}

// Human-readable rendering (used as the MCP tool's text content, and by the
// /api/check?format=md link so Claude.ai chat / a browser get a clean summary).
// Pass { hops: true } to append the per-hop chain under each result.
export function formatResults({ summary, results }, opts = {}) {
  const lines = [`Checked ${summary.checked} — ${summary.passed} pass, ${summary.failed} fail, ${summary.blocked} blocked.`];
  for (const r of results) {
    const tag = r.verdict + (r.reason ? ` (${r.reason})` : '');
    const status = r.finalStatus != null ? ` [${r.finalStatus}]` : '';
    const exp = r.expected ? `  expected: ${r.expected}` : '';
    const err = r.error ? `  ⚠ ${r.error}` : '';
    lines.push(`• ${tag} — ${r.source} → ${r.finalUrl ?? '—'}${status}${exp}${err}`);
    if (opts.hops && Array.isArray(r.hops) && r.hops.length) {
      for (const h of r.hops) {
        const arrow = h.location ? ` → ${h.location}` : '';
        lines.push(`    ${h.status ?? '—'}  ${h.url}${arrow}  (${h.server}, ${h.timeMs}ms)`);
      }
    }
  }
  return lines.join('\n');
}
