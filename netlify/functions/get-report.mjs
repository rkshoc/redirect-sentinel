// get-report — read one archived audit and merge any Playwright deep-check
// results (CLAUDE.md §3, §8). Acts as a token-holding proxy so the browser
// never sees the GitHub token and can read reports from a private repo.
//
// Used both for polling a just-run audit and for re-rendering history. The base
// report file is immutable; deep-check results live in a companion file written
// once by the Actions workflow. We merge them here at read time so we never
// edit the original (avoids concurrent-write races).

import { getFile } from './lib/github.mjs';
import { summarise } from './lib/report.mjs';
import { VERDICT } from './lib/verdict.mjs';
import { formatResults } from './lib/check-core.mjs';

const json = (body, status = 200) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

// Only allow paths inside the YYYY/MM/DD tree ending in .json — no traversal.
function safePath(p) {
  if (!p) return null;
  if (p.includes('..') || p.startsWith('/')) return null;
  if (!/^\d{4}\/\d{2}\/\d{2}\/[\w.\-]+\.json$/.test(p)) return null;
  return p;
}

// Merge a Playwright deep-check companion into the base report at read time.
// Applies whatever results came back; if the companion also carries an `error`
// (dispatch failed, the run crashed, or it finished only partially), any row
// still without a deep result is resolved to a TERMINAL state instead of
// spinning "pending" forever — it stays BLOCKED (inconclusive, never a FAIL).
// Exported for unit testing.
export function mergeDeepCheck(report, companion) {
  if (!companion) return report;

  const results = Array.isArray(companion.results) ? companion.results : [];
  const bySource = new Map(results.map((r) => [r.source, r]));
  let pending = 0;

  report.rows = report.rows.map((row) => {
    if (!row.deepPending) return row;
    const dc = bySource.get(row.source);
    if (dc) {
      return {
        ...row,
        finalUrl: dc.finalUrl ?? row.finalUrl,
        finalStatus: dc.finalStatus ?? row.finalStatus,
        hopCount: dc.hopCount ?? row.hopCount,
        verdict: dc.verdict ?? row.verdict,
        reason: dc.reason ?? row.reason,
        hops: dc.hops || row.hops,
        error: dc.error ?? row.error,
        deepChecked: true,
        deepPending: false,
      };
    }
    // No deep result for this row. If the run errored, stop waiting (terminal);
    // otherwise it's still legitimately in flight.
    if (companion.error) return { ...row, deepPending: false };
    pending++;
    return row;
  });

  report.summary = summarise(report.rows);
  report.status = pending > 0 ? 'partial' : 'complete';
  if (report.deepCheck) {
    report.deepCheck.pending = pending;
    if (companion.error) report.deepCheck.error = companion.error;
  }
  return report;
}

export const handler = async (event) => {
  const path = safePath((event.queryStringParameters || {}).path);
  if (!path) return json({ error: 'invalid or missing report path' }, 400);

  let base;
  try {
    const file = await getFile(path);
    if (!file) return json({ error: 'not found', pending: true }, 404);
    base = JSON.parse(file.content);
  } catch (e) {
    return json({ error: e.message }, 500);
  }

  // Merge deep-check companion if this report had blocked rows.
  if (base.status === 'partial' && base.deepCheck && base.deepCheck.companion) {
    const compPath = path.replace(/[^/]+$/, base.deepCheck.companion);
    try {
      const comp = await getFile(compPath);
      if (comp) mergeDeepCheck(base, JSON.parse(comp.content));
    } catch { /* companion not ready yet — return partial */ }
  }

  // ?format=md|text → a clean readable summary of the whole report (verdict +
  // hop chains), so a finished audit of any size can be read by Claude.ai chat
  // (or a browser) in a SINGLE fetch instead of one request per URL.
  const fmt = String((event.queryStringParameters || {}).format || '').toLowerCase();
  if (['md', 'markdown', 'text'].includes(fmt)) {
    const head = `${base.filename || 'audit'} — ${base.status || 'complete'} — ${base.createdUtc || ''}`;
    const body = `${head}\n${'='.repeat(head.length)}\n${formatResults({ summary: base.summary, results: base.rows || [] }, { hops: true })}`;
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
      body,
    };
  }

  return json(base);
};
