// Audit gatekeeper — sync Netlify function (CLAUDE.md §4).
//
// Background functions do NOT receive Netlify Identity's clientContext.user, so
// identity must be resolved here, in a regular (sync) function where the
// gateway populates it. This function:
//   1. authenticates + enforces the tier limit SYNCHRONOUSLY (instant feedback),
//   2. computes the authoritative archive path from the verified identity,
//   3. triggers the heavy `audit-background` worker (passing the verified
//      identity + path, protected by an internal shared secret),
//   4. returns the path so the browser polls the right file (no guessing).

import { resolveIdentity, checkLimit, shortId } from './lib/auth.mjs';
import { archivePaths } from './lib/report.mjs';

const json = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

function countItems(payload) {
  if (payload.mode === 'paste') return (payload.urls || []).map((u) => String(u).trim()).filter(Boolean).length;
  return (payload.rows || []).length;
}

export const handler = async (event, context) => {
  if (event.httpMethod && event.httpMethod !== 'POST') return json(405, { error: 'method not allowed' });

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Bad request' });
  }

  const identity = resolveIdentity(context.clientContext);

  // SERVER-SIDE limit enforcement (CLAUDE.md §4) — never trust the browser.
  const limitErr = checkLimit(countItems(payload), identity);
  if (limitErr) return json(limitErr.status, { error: limitErr.message });

  // Authoritative archive path from the verified identity + client timestamp/id.
  const ts = Date.parse(payload.timestamp || '');
  const now = Number.isFinite(ts) ? new Date(ts) : new Date();
  const id = (payload.id && /^[a-z0-9]{2,12}$/i.test(payload.id)) ? payload.id : shortId();
  const userLabel = identity.user || 'anon';
  const paths = archivePaths(now, userLabel, id);

  // Trigger the background worker. The internal token gates the public
  // background endpoint so it can't be called directly to bypass limits.
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL || '';
  const secret = process.env.INTERNAL_TOKEN || process.env.GITHUB_TOKEN || '';
  try {
    const res = await fetch(`${base}/.netlify/functions/audit-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-token': secret },
      body: JSON.stringify({
        ...payload,
        id,
        _identity: identity,
        _paths: paths,
        _now: now.toISOString(),
      }),
    });
    if (res.status >= 400) {
      const t = await res.text().catch(() => '');
      return json(502, { error: `Could not start audit (worker ${res.status}). ${t}`.trim() });
    }
  } catch (e) {
    return json(502, { error: `Could not start audit: ${e.message}` });
  }

  return json(200, { ok: true, path: paths.json });
};
