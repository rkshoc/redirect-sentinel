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

// POST the audit to the background worker. Returns the raw Response so the caller
// can distinguish 202 (accepted) from a synchronous 4xx rejection.
export async function postAudit(payload) {
  return fetch('/api/audit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify(payload),
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
