// All /api/* calls live here (CLAUDE.md contract). authHeaders() reads the
// Netlify Identity JWT from the widget singleton; never ships any secret.

import netlifyIdentity from 'netlify-identity-widget';

export async function authHeaders() {
  const u = netlifyIdentity.currentUser();
  if (!u) return {};
  try {
    const jwt = await u.jwt(); // refreshes if needed
    return { Authorization: `Bearer ${jwt}` };
  } catch {
    return {};
  }
}

// Server-signed identity token + authoritative user label for the archive path,
// so the background worker can trust who we are.
export async function whoami(user) {
  if (!user) return { token: null, userLabel: 'anon' };
  try {
    const res = await fetch('/api/whoami', { headers: await authHeaders() });
    if (res.ok) {
      const w = await res.json();
      return { token: w.token || null, userLabel: w.user || user.email };
    }
  } catch { /* fall through */ }
  return { token: null, userLabel: user.email };
}

// Hard cap per run — beyond this the compressed payload approaches Netlify's
// 256 KB background-function limit and the 15-min processing window, so we ask
// users to split instead (tier limits still apply below this).
export const MAX_AUDIT_URLS = 3000;

// gzip + base64 a string via the browser CompressionStream API.
async function gzipBase64(str) {
  const stream = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

// POST the audit to the dispatch endpoint, which stages the input and fires the
// Playwright-on-Actions engine, returning 202 + the report path to poll (or a
// synchronous 4xx for an over-limit request / 502 if the engine can't be
// dispatched). Large URL lists compress ~10x, so we gzip big payloads; the
// function transparently gunzips a { gz } body.
export async function postAudit(payload) {
  const json = JSON.stringify(payload);
  let body = json;
  if (json.length > 150000 && typeof CompressionStream !== 'undefined') {
    try { body = JSON.stringify({ gz: await gzipBase64(json) }); } catch { body = json; }
  }
  return fetch('/api/audit-dispatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body,
  });
}

export async function getReport(path) {
  const res = await fetch(`/api/report?path=${encodeURIComponent(path)}`, { headers: await authHeaders() });
  return res;
}

export async function listAllReports({ days, limit } = {}) {
  const qs = new URLSearchParams();
  if (days) qs.set('days', days);
  if (limit) qs.set('limit', limit);
  const res = await fetch(`/api/reports/all${qs.toString() ? `?${qs}` : ''}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}
