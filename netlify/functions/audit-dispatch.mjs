// audit-dispatch — THIN Netlify sync function that runs the full audit on
// GitHub Actions + Playwright instead of on Netlify (CLAUDE.md §2/§3 evolution:
// engine moved off Netlify to save runtime + run a real browser from a fresh IP).
//
// Flow: verify identity + tier limit (server-side) -> commit the normalised
// input to the reports repo -> dispatch the `audit.yml` workflow -> return the
// predicted report path. The browser/extension polls /api/report for the result.
// No tracing happens here, so Netlify runtime stays tiny.

import zlib from 'node:zlib';
import { buildItems } from './lib/audit.mjs';
import { resolveIdentity, verifyIdentity, checkLimit, shortId } from './lib/auth.mjs';
import { archivePaths } from './lib/report.mjs';
import { putFile, dispatchWorkflow, ghConfig } from './lib/github.mjs';

const AUDIT_WORKFLOW = process.env.AUDIT_WORKFLOW || 'audit.yml';

const json = (status, body) => ({
  statusCode: status,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    // CORS-open so the Chrome extension (and other clients) can call it.
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  },
  body: JSON.stringify(body),
});

export const handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }, body: '' };
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only.' });

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
    if (payload && payload.gz) {
      payload = JSON.parse(zlib.gunzipSync(Buffer.from(payload.gz, 'base64')).toString('utf8'));
    }
  } catch {
    return json(400, { error: 'Bad request' });
  }

  // Identity: a sync function gets clientContext from the Netlify Identity JWT.
  // Also accept a server-signed _auth token (the existing whoami flow / clients
  // that can't populate clientContext). Limits stay enforced SERVER-SIDE.
  const identity = verifyIdentity(payload._auth) || resolveIdentity(context.clientContext);

  const items = buildItems(payload);
  if (!items.length) return json(400, { error: 'No auditable URLs found. Provide URLs or a sheet with a Source column.' });

  const limitErr = checkLimit(items.length, identity);
  if (limitErr) return json(limitErr.status, { error: limitErr.message });

  const cfg = ghConfig();
  if (!cfg.token || !cfg.reportsOwner) {
    return json(500, { error: 'Server not configured for archival (GITHUB_TOKEN / REPORTS_OWNER missing).' });
  }

  const ts = Date.parse(payload.timestamp || '');
  const now = Number.isFinite(ts) ? new Date(ts) : new Date();
  const id = (payload.id && /^[a-z0-9]{2,12}$/i.test(payload.id)) ? payload.id : shortId();
  const userLabel = identity.user || 'anon';
  const paths = archivePaths(now, userLabel, id);
  const inputPath = `${paths.dir}/${paths.base}.input.json`;

  // The input the Actions engine consumes: normalised items + the metadata it
  // needs to assemble an identical report (CLAUDE.md §7).
  const input = {
    id,
    base: paths.base,
    createdUtc: now.toISOString(),
    createdLocal: payload.localTime || null,
    user: userLabel,
    role: identity.role || null,
    mode: payload.mode || 'sheet',
    baseUrl: payload.baseUrl || process.env.DEFAULT_BASE_URL || null,
    mapping: payload.mapping || null,
    columns: payload.columns || null,
    reportPath: paths.json,
    items,
  };

  try {
    await putFile(inputPath, JSON.stringify(input), `audit input ${paths.base}`);
  } catch (e) {
    return json(500, { error: `Could not stage audit input: ${e.message}` });
  }

  try {
    await dispatchWorkflow(AUDIT_WORKFLOW, {
      input_path: inputPath,
      report_path: paths.json,
      report_base: paths.base,
      reports_owner: cfg.reportsOwner,
      reports_repo: cfg.reportsRepo,
      reports_branch: cfg.reportsBranch,
    });
  } catch (e) {
    // Surface the dispatch failure (e.g. workflow not registered — same fix as
    // the deep-check: enable Actions + the workflow must be on the default branch).
    return json(502, { error: e.message, report: paths.json });
  }

  return json(202, { ok: true, report: paths.json, count: items.length, engine: 'playwright' });
};
