// Playwright deep-check (CLAUDE.md §3, §5).
//
// Runs on GitHub Actions (public repo = unlimited minutes) when the HTTP engine
// was WAF-blocked. The GitHub runner has a different IP and a real browser, so
// it can clear volume throttles and solve JS challenges. It reads the immutable
// base report from the reports repo, re-traces only the blocked rows in
// Chromium, classifies with the SAME strict verdict logic, then writes a NEW
// companion file (<base>.deepcheck.json) — it never edits the base report.

import { chromium } from 'playwright';
import { classify } from '../../netlify/functions/lib/verdict.mjs';
import { tagServer } from '../../netlify/functions/lib/servertag.mjs';

const API = 'https://api.github.com';
const {
  REPORTS_TOKEN, REPORTS_OWNER, REPORTS_REPO, REPORTS_BRANCH = 'main',
  REPORT_PATH, REPORT_BASE,
} = process.env;

if (!REPORTS_TOKEN || !REPORTS_OWNER || !REPORTS_REPO || !REPORT_PATH) {
  console.error('Missing required env (REPORTS_TOKEN/REPORTS_OWNER/REPORTS_REPO/REPORT_PATH).');
  process.exit(1);
}

function ghHeaders() {
  return {
    Authorization: `Bearer ${REPORTS_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'redirect-sentinel-deepcheck',
    'Content-Type': 'application/json',
  };
}

async function getJson(path) {
  const url = `${API}/repos/${REPORTS_OWNER}/${REPORTS_REPO}/contents/${path}?ref=${encodeURIComponent(REPORTS_BRANCH)}`;
  const res = await fetch(url, { headers: ghHeaders() });
  if (!res.ok) throw new Error(`getJson ${path}: ${res.status}`);
  const j = await res.json();
  return JSON.parse(Buffer.from(j.content, 'base64').toString('utf8'));
}

async function putJson(path, obj, message) {
  const url = `${API}/repos/${REPORTS_OWNER}/${REPORTS_REPO}/contents/${path}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: ghHeaders(),
    body: JSON.stringify({
      message,
      content: Buffer.from(JSON.stringify(obj, null, 2), 'utf8').toString('base64'),
      branch: REPORTS_BRANCH,
    }),
  });
  if (!res.ok) throw new Error(`putJson ${path}: ${res.status} ${await res.text()}`);
}

async function traceBrowser(context, url) {
  const page = await context.newPage();
  try {
    const resp = await page.goto(url, { waitUntil: 'load', timeout: 45000 });
    // Walk the redirect chain back to the original request.
    const reqs = [];
    let req = resp ? resp.request() : null;
    while (req) { reqs.unshift(req); req = req.redirectedFrom(); }
    let n = 0;
    const hops = [];
    for (const r of reqs) {
      const rr = await r.response();
      const headers = rr ? rr.headers() : {};
      let timeMs = 0;
      try { const t = r.timing(); if (t && t.responseEnd > 0) timeMs = Math.round(t.responseEnd); } catch { /* ignore */ }
      hops.push({ n: ++n, url: r.url(), status: rr ? rr.status() : null, server: tagServer(headers), location: headers.location || null, timeMs });
    }
    const last = hops[hops.length - 1] || null;
    return { source: url, finalUrl: page.url(), finalStatus: last ? last.status : null, hopCount: hops.length, blocked: false, loop: false, error: null, hops };
  } catch (e) {
    return { source: url, finalUrl: null, finalStatus: null, hopCount: 0, blocked: false, loop: false, error: e.message, hops: [] };
  } finally {
    await page.close();
  }
}

const companionPath = REPORT_PATH.replace(/[^/]+$/, `${REPORT_BASE}.deepcheck.json`);
// Collected outside the try so a mid-run failure can still write back whatever
// completed — get-report then flips the report to a TERMINAL state (any row
// without a result stays BLOCKED) instead of leaving the UI "pending" until its
// 14-minute poll deadline.
const results = [];

(async () => {
  const base = await getJson(REPORT_PATH);
  const blocked = base.rows.filter((r) => r.deepPending);
  console.log(`Deep-checking ${blocked.length} blocked URL(s) for ${REPORT_BASE}`);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-US',
  });

  // Same batching discipline as the HTTP side (CLAUDE.md §3): low concurrency,
  // small chunks. Sequential here is simplest and well under any WAF window.
  for (const row of blocked) {
    const t = await traceBrowser(context, row.source);
    const { verdict, reason } = classify({
      expected: row.expected, finalUrl: t.finalUrl, finalStatus: t.finalStatus,
      hopCount: t.hopCount, blocked: t.blocked, loop: t.loop,
    });
    results.push({ source: row.source, finalUrl: t.finalUrl, finalStatus: t.finalStatus, hopCount: t.hopCount, verdict, reason, hops: t.hops, error: t.error });
    await new Promise((r) => setTimeout(r, 1500)); // gentle pacing
  }

  await browser.close();

  await putJson(companionPath, { base: REPORT_BASE, completedUtc: new Date().toISOString(), results }, `deep-check ${REPORT_BASE}`);
  console.log(`Wrote ${companionPath} with ${results.length} result(s).`);
})().catch(async (e) => {
  console.error(e);
  // Best-effort terminal companion: include any partial results + the error so
  // the report stops waiting. Swallow a secondary write failure.
  try {
    await putJson(
      companionPath,
      { base: REPORT_BASE, completedUtc: new Date().toISOString(), results, error: e.message },
      `deep-check ${REPORT_BASE} (error)`,
    );
    console.error(`Wrote error companion ${companionPath} (${results.length} partial result(s)).`);
  } catch (e2) {
    console.error('Could not write error companion:', e2.message);
  }
  process.exit(1);
});
