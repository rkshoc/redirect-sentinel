// Core logic for the Redirect Sentinel MCP server — kept dependency-free and
// separate from the stdio wiring so it can be unit-tested without the SDK.
//
// Calls the deployed POST /api/check endpoint. That endpoint is capped at 10
// URLs per call (anon tier), so we chunk larger requests and pace them with a
// short delay to stay WAF-friendly. A hard ceiling keeps interactive use sane —
// genuinely large audits belong in the app's /api/audit flow.

export const PER_CALL = 10; // matches /api/check's cap
export const MAX_TOTAL = 50; // ceiling for this tool

export function endpointUrl(base) {
  if (!base) {
    throw new Error('Set REDIRECT_SENTINEL_URL to your deployed site, e.g. https://your-site.netlify.app');
  }
  return base.replace(/\/+$/, '') + '/api/check';
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// Normalise the two accepted input shapes into a flat items[] list.
export function toItems({ items, urls } = {}) {
  if (Array.isArray(items) && items.length) {
    return items.filter((it) => it && it.source).map((it) => ({
      source: String(it.source),
      ...(it.expected ? { expected: String(it.expected) } : {}),
      ...(it.ruleName ? { ruleName: String(it.ruleName) } : {}),
    }));
  }
  if (Array.isArray(urls)) {
    return urls.map((u) => String(u || '').trim()).filter(Boolean).map((source) => ({ source }));
  }
  return [];
}

export function summarize(results) {
  const summary = { checked: results.length, passed: 0, failed: 0, blocked: 0 };
  for (const r of results) {
    if (r.verdict === 'PASS') summary.passed++;
    else if (r.verdict === 'FAIL') summary.failed++;
    else if (r.verdict === 'BLOCKED') summary.blocked++;
  }
  return summary;
}

/**
 * Run a redirect check via the deployed endpoint, chunking + pacing as needed.
 * @param {object} args
 * @param {string} args.baseUrl deployed site base (REDIRECT_SENTINEL_URL)
 * @param {Array}  [args.items] {source, expected?, ruleName?}
 * @param {Array}  [args.urls]  source URLs (no expected comparison)
 * @param {string} [args.baseForRelative] resolves relative source/expected paths
 * @param {Function} [args.fetchImpl] injectable for tests
 * @param {number} [args.delayMs] pause between chunks
 */
export async function runCheck({ baseUrl, items, urls, baseForRelative, fetchImpl = fetch, delayMs = 1500 }) {
  const all = toItems({ items, urls });
  if (!all.length) throw new Error('Provide "urls": [...] or "items": [{ source, expected? }].');
  if (all.length > MAX_TOTAL) {
    throw new Error(`Too many URLs (${all.length}). This tool handles up to ${MAX_TOTAL}; use the app's audit flow (/api/audit) for larger sets.`);
  }
  const url = endpointUrl(baseUrl);
  const groups = chunk(all, PER_CALL);
  const results = [];
  for (let i = 0; i < groups.length; i++) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: groups[i], ...(baseForRelative ? { baseUrl: baseForRelative } : {}) }),
    });
    if (!res.ok) {
      const text = await (res.text ? res.text().catch(() => '') : Promise.resolve(''));
      throw new Error(`/api/check returned ${res.status}: ${String(text).slice(0, 200)}`);
    }
    const body = await res.json();
    results.push(...(body.results || []));
    if (i < groups.length - 1 && delayMs) await new Promise((r) => setTimeout(r, delayMs));
  }
  return { summary: summarize(results), results };
}

// Human-readable rendering for the tool's text content.
export function formatText({ summary, results }) {
  const lines = [`Checked ${summary.checked} — ${summary.passed} pass, ${summary.failed} fail, ${summary.blocked} blocked.`];
  for (const r of results) {
    const tag = r.verdict + (r.reason ? ` (${r.reason})` : '');
    const status = r.finalStatus != null ? ` [${r.finalStatus}]` : '';
    const exp = r.expected ? `  expected: ${r.expected}` : '';
    const err = r.error ? `  ⚠ ${r.error}` : '';
    lines.push(`• ${tag} — ${r.source} → ${r.finalUrl ?? '—'}${status}${exp}${err}`);
  }
  return lines.join('\n');
}
