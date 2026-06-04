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

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

// Only allow paths inside the YYYY/MM/DD tree ending in .json — no traversal.
function safePath(p) {
  if (!p) return null;
  if (p.includes('..') || p.startsWith('/')) return null;
  if (!/^\d{4}\/\d{2}\/\d{2}\/[\w.\-]+\.json$/.test(p)) return null;
  return p;
}

function mergeDeepCheck(report, companion) {
  if (!companion || !Array.isArray(companion.results)) return report;
  const bySource = new Map(companion.results.map((r) => [r.source, r]));
  let pending = 0;
  report.rows = report.rows.map((row) => {
    if (!row.deepPending) return row;
    const dc = bySource.get(row.source);
    if (!dc) { pending++; return row; } // still waiting
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
  });
  report.summary = summarise(report.rows);
  report.status = pending > 0 ? 'partial' : 'complete';
  if (report.deepCheck) report.deepCheck.pending = pending;
  return report;
}

export default async (req) => {
  const url = new URL(req.url);
  const path = safePath(url.searchParams.get('path'));
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

  return json(base);
};
