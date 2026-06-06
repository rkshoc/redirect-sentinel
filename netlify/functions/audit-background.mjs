// Audit engine — Netlify *background* function (CLAUDE.md §2, §3).
//
// Named with the -background suffix so Netlify gives it up to 15 minutes
// (vs. the 10s sync limit) to run the full WAF-friendly batched audit. It
// returns 202 immediately with no useful body; the browser polls get-report
// for the result file, which it can predict from the audit id it supplied.
//
// Flow: auth + limit check -> trace each URL (batched) -> strict verdict +
// reason -> commit immutable JSON+CSV to the reports repo -> dispatch the
// Playwright deep-check workflow for any WAF-blocked URLs (results land later
// in a companion file that get-report merges).

import { trace, BROWSER_HEADERS } from './lib/engine.mjs';
import { runBatched, BATCH_DEFAULTS, chunk } from './lib/batch.mjs';
import { classify, VERDICT } from './lib/verdict.mjs';
import { resolveIdentity, verifyIdentity, checkLimit, shortId } from './lib/auth.mjs';
import { archivePaths, summarise, toCSV } from './lib/report.mjs';
import { putFile, dispatchDeepCheck, ghConfig } from './lib/github.mjs';

// Resolve a possibly-relative URL against the audit's base URL.
function abs(value, baseUrl) {
  const v = value == null ? '' : String(value).trim();
  if (!v) return null;
  try {
    return new URL(v, baseUrl || undefined).toString();
  } catch {
    return null;
  }
}

// Turn the client payload into a flat list of audit items.
function buildItems(payload) {
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
  return (payload.rows || []).map((row) => {
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

function batchOpts() {
  return {
    batchSize: Number(process.env.BATCH_SIZE) || BATCH_DEFAULTS.batchSize,
    concurrency: Number(process.env.BATCH_CONCURRENCY) || BATCH_DEFAULTS.concurrency,
    cooldownMs: Number(process.env.BATCH_COOLDOWN_MS) || BATCH_DEFAULTS.cooldownMs,
  };
}

const json = (status, body) => ({ statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// Background worker. The browser calls this directly (Netlify only executes
// background functions on a direct external HTTP trigger, and does not populate
// clientContext.user for them). A logged-in browser includes a server-signed
// identity token (`_auth`) issued by /api/whoami, which we verify here; limits
// stay enforced server-side and can't be forged (CLAUDE.md §4).
export const handler = async (event, context) => {
  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Bad request' });
  }

  const identity = verifyIdentity(payload._auth) || resolveIdentity(context.clientContext);
  const items = buildItems(payload);

  // SERVER-SIDE limit enforcement (CLAUDE.md §4) — never trust the browser.
  const limitErr = checkLimit(items.length, identity);
  if (limitErr) return json(limitErr.status, { error: limitErr.message });

  // Client supplies UTC timestamp + id so it can predict the archive path to
  // poll. The user label comes from the verified identity, matching the path
  // the browser computed from /api/whoami's `user`.
  const ts = Date.parse(payload.timestamp || '');
  const now = Number.isFinite(ts) ? new Date(ts) : new Date();
  const id = (payload.id && /^[a-z0-9]{2,12}$/i.test(payload.id)) ? payload.id : shortId();
  const userLabel = identity.user || 'anon';
  const paths = archivePaths(now, userLabel, id);

  // Run the audit. Background functions can take their time, so we await fully.
  // (Netlify returns 202 to the client the moment this handler was invoked.)
  const results = await runBatched(
    items,
    async (item) => {
      if (!item.source || !/^https?:/i.test(item.source)) {
        return { ...item, trace: { source: item.source, finalUrl: null, finalStatus: null, hopCount: 0, blocked: false, loop: false, error: 'invalid or relative URL (set a base URL)', hops: [] } };
      }
      const t = await trace(item.source, { perHopTimeoutMs: Number(process.env.HOP_TIMEOUT_MS) || 12000 });
      return { ...item, trace: t };
    },
    batchOpts(),
  );

  const rows = results.map((r) => {
    const t = r.trace;
    const { verdict, reason } = classify({
      expected: r.expected,
      finalUrl: t.finalUrl,
      finalStatus: t.finalStatus,
      hopCount: t.hopCount,
      blocked: t.blocked,
      loop: t.loop,
    });
    return {
      ruleName: r.ruleName,
      source: r.source,
      expected: r.expected,
      extra: r.extra,
      finalUrl: t.finalUrl,
      finalStatus: t.finalStatus,
      hopCount: t.hopCount,
      verdict,
      reason,
      error: t.error,
      hops: t.hops,
      deepChecked: false,
      deepPending: verdict === VERDICT.BLOCKED,
    };
  });

  const blockedSources = rows.filter((r) => r.deepPending).map((r) => r.source);
  const hasDeepChecks = blockedSources.length > 0;

  const report = {
    id,
    filename: paths.base,
    createdUtc: now.toISOString(),
    createdLocal: payload.localTime || null,
    user: userLabel,
    role: identity.role,
    mode: payload.mode || 'sheet',
    baseUrl: payload.baseUrl || process.env.DEFAULT_BASE_URL || null,
    mapping: payload.mapping || null,
    columns: payload.columns || null,
    status: hasDeepChecks ? 'partial' : 'complete',
    deepCheck: hasDeepChecks ? { pending: blockedSources.length, companion: `${paths.base}.deepcheck.json` } : null,
    summary: summarise(rows),
    rows,
  };

  // Commit immutable JSON + CSV (one new file each — never edit; CLAUDE.md §8).
  try {
    await putFile(paths.json, JSON.stringify(report, null, 2), `audit ${paths.base} (json)`);
    await putFile(paths.csv, toCSV(report), `audit ${paths.base} (csv)`);
    await updateDayIndex(paths, report).catch(() => {}); // best-effort; never blocks
  } catch (e) {
    // Archival failed (likely misconfigured token). Surface it in logs; the
    // client poll will time out and show the error path.
    console.error('Archival failed:', e.message);
    return json(500, { error: e.message });
  }

  // Dispatch Playwright deep-check for blocked URLs (CLAUDE.md §3).
  if (hasDeepChecks) {
    try {
      const cfg = ghConfig();
      await dispatchDeepCheck({
        report_path: paths.json,
        report_base: paths.base,
        reports_owner: cfg.reportsOwner,
        reports_repo: cfg.reportsRepo,
        reports_branch: cfg.reportsBranch,
        urls: JSON.stringify(blockedSources),
      });
    } catch (e) {
      console.error('Deep-check dispatch failed:', e.message);
      // Non-fatal: the base report still stands; rows remain BLOCKED.
    }
  }

  return json(200, { ok: true, report: paths.json });
};

// Best-effort per-day index for the history view (CLAUDE.md §8). Index write
// races must never break an audit, so all errors are swallowed by the caller.
async function updateDayIndex(paths, report) {
  const indexPath = `${paths.dir}/index.json`;
  const { getFile } = await import('./lib/github.mjs');
  let index = { day: paths.dir, audits: [] };
  const existing = await getFile(indexPath).catch(() => null);
  if (existing) {
    try { index = JSON.parse(existing.content); } catch { /* keep fresh */ }
  }
  // Store the FULL path (incl. YYYY/MM/DD/) so the history view can open it
  // directly via get-report, which requires the dated path.
  index.audits = (index.audits || []).filter((a) => a.file !== paths.json && a.file !== `${paths.base}.json`);
  index.audits.push({
    file: paths.json,
    name: paths.base,
    id: report.id,
    user: report.user,
    createdUtc: report.createdUtc,
    summary: report.summary,
    status: report.status,
  });
  index.audits.sort((a, b) => (a.createdUtc < b.createdUtc ? 1 : -1));
  await putFile(indexPath, JSON.stringify(index, null, 2), `index ${paths.dir}`, { overwrite: true });
}
