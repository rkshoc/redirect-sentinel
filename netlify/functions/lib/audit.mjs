// Shared audit helpers — single-source the item-building and the verdict/report
// assembly so the dispatch function, the (legacy) Netlify HTTP engine, and the
// GitHub Actions Playwright engine all produce IDENTICAL report shapes and apply
// the SAME strict verdict logic (CLAUDE.md §6, §7).

import { classify } from './verdict.mjs';
import { summarise } from './report.mjs';

// Resolve a possibly-relative URL against the audit's base URL.
export function abs(value, baseUrl) {
  const v = value == null ? '' : String(value).trim();
  if (!v) return null;
  try {
    return new URL(v, baseUrl || undefined).toString();
  } catch {
    return null;
  }
}

// Turn a client payload ({ mode:'paste', urls } or { mode:'sheet', columns,
// mapping, rows }) into a flat list of audit items. Blank/incomplete sheet rows
// are dropped so they don't count against the tier limit or waste requests.
export function buildItems(payload) {
  const baseUrl = payload.baseUrl || process.env.DEFAULT_BASE_URL || '';
  if (payload.mode === 'paste') {
    const urls = (payload.urls || []).map((u) => String(u).trim()).filter(Boolean);
    return urls.map((u) => ({ ruleName: '', source: abs(u, baseUrl) || u, rawSource: u, expected: null, extra: {} }));
  }
  // sheet mode
  const cols = payload.columns || [];
  const map = payload.mapping || {};
  const ruleIdx = map.ruleName;
  const srcIdx = map.source;
  const expIdx = map.expected;
  const extraIdx = cols.map((_, i) => i).filter((i) => i !== ruleIdx && i !== srcIdx && i !== expIdx);
  return (payload.rows || []).filter((row) => {
    if (String(row[srcIdx] ?? '').trim() === '') return false;
    if (expIdx != null && String(row[expIdx] ?? '').trim() === '') return false;
    return true;
  }).map((row) => {
    const extra = {};
    for (const i of extraIdx) extra[cols[i] || `col${i}`] = row[i] ?? '';
    const rawSource = row[srcIdx] ?? '';
    const rawExpected = expIdx == null ? null : (row[expIdx] ?? '');
    return {
      ruleName: ruleIdx == null ? '' : (row[ruleIdx] ?? ''),
      source: abs(rawSource, baseUrl) || rawSource,
      rawSource,
      expected: rawExpected ? (abs(rawExpected, baseUrl) || rawExpected) : null,
      extra,
    };
  });
}

/**
 * Map one traced item ({ ...item, trace }) to a report row using the strict
 * verdict. `deepPending` defaults false (the Playwright engine is terminal — no
 * further fallback); the legacy HTTP engine overrides it for blocked rows.
 */
export function rowFromResult(r, { deepPending = false } = {}) {
  const t = r.trace || {};
  const { verdict, reason } = classify({
    expected: r.expected,
    finalUrl: t.finalUrl,
    finalStatus: t.finalStatus,
    hopCount: t.hopCount,
    blocked: t.blocked,
    loop: t.loop,
    inconclusive: t.inconclusive,
    error: t.error,
  });
  return {
    ruleName: r.ruleName || '',
    source: r.source,
    expected: r.expected ?? null,
    extra: r.extra || {},
    finalUrl: t.finalUrl ?? null,
    finalStatus: t.finalStatus ?? null,
    hopCount: t.hopCount ?? 0,
    verdict,
    reason,
    error: t.error ?? null,
    hops: t.hops || [],
    deepChecked: false,
    deepPending: typeof deepPending === 'function' ? !!deepPending(verdict) : !!deepPending,
  };
}

/** Assemble the immutable report object the app re-renders from (CLAUDE.md §7). */
export function buildReport(meta, rows) {
  return {
    id: meta.id,
    filename: meta.base,
    createdUtc: meta.createdUtc,
    createdLocal: meta.createdLocal || null,
    user: meta.user || 'anon',
    role: meta.role || null,
    engine: meta.engine || 'playwright',
    mode: meta.mode || 'sheet',
    baseUrl: meta.baseUrl || null,
    mapping: meta.mapping || null,
    columns: meta.columns || null,
    status: meta.status || 'complete',
    deepCheck: meta.deepCheck || null,
    summary: summarise(rows),
    rows,
  };
}
