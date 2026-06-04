// GitHub archival + Actions dispatch — see CLAUDE.md §3, §8.
//
// The Netlify Function (never the browser) commits each audit to the separate
// reports repo via the Contents API, and dispatches the Playwright workflow for
// blocked URLs. The token lives in Netlify env (GITHUB_TOKEN), scoped minimally
// to `workflow` + contents-write on the reports repo. Plain fetch — no Octokit
// dependency.

const API = 'https://api.github.com';

function env(name, fallback) {
  return process.env[name] || fallback;
}

export function ghConfig() {
  return {
    token: env('GITHUB_TOKEN'),
    // owner/name of the archive repo, e.g. "rkshoc"
    reportsOwner: env('REPORTS_OWNER'),
    reportsRepo: env('REPORTS_REPO', 'redirect-sentinel-reports'),
    reportsBranch: env('REPORTS_BRANCH', 'main'),
    // app repo holding the deep-check workflow
    appOwner: env('APP_OWNER', env('REPORTS_OWNER')),
    appRepo: env('APP_REPO', 'redirect-sentinel'),
    appBranch: env('APP_BRANCH', 'main'),
    workflowFile: env('DEEPCHECK_WORKFLOW', 'deep-check.yml'),
  };
}

function headers(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'redirect-sentinel',
    'Content-Type': 'application/json',
  };
}

function b64(str) {
  return Buffer.from(str, 'utf8').toString('base64');
}

/**
 * Create (or update) a file in the reports repo. Writing to a deep path
 * auto-creates intermediate folders (CLAUDE.md §8). We use one brand-new
 * uniquely-named file per audit, so normally there is no existing SHA; if the
 * caller asks to overwrite (e.g. a per-day index) we look it up first.
 */
export async function putFile(path, content, message, { overwrite = false } = {}) {
  const cfg = ghConfig();
  if (!cfg.token || !cfg.reportsOwner) {
    throw new Error('GitHub archival not configured (GITHUB_TOKEN / REPORTS_OWNER missing).');
  }
  const url = `${API}/repos/${cfg.reportsOwner}/${cfg.reportsRepo}/contents/${path}`;
  const body = { message, content: b64(content), branch: cfg.reportsBranch };

  if (overwrite) {
    // Need the current SHA to update in place.
    const existing = await fetch(`${url}?ref=${encodeURIComponent(cfg.reportsBranch)}`, {
      headers: headers(cfg.token),
    });
    if (existing.ok) {
      const json = await existing.json();
      if (json && json.sha) body.sha = json.sha;
    }
  }

  const res = await fetch(url, { method: 'PUT', headers: headers(cfg.token), body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub putFile ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

/** Read a file from the reports repo. Returns { content, sha } or null (404). */
export async function getFile(path) {
  const cfg = ghConfig();
  if (!cfg.token || !cfg.reportsOwner) throw new Error('GitHub not configured.');
  const url = `${API}/repos/${cfg.reportsOwner}/${cfg.reportsRepo}/contents/${path}?ref=${encodeURIComponent(cfg.reportsBranch)}`;
  const res = await fetch(url, { headers: headers(cfg.token) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub getFile ${path} failed: ${res.status}`);
  const json = await res.json();
  return { content: Buffer.from(json.content, 'base64').toString('utf8'), sha: json.sha };
}

/** List a directory in the reports repo. Returns [] on 404. */
export async function listDir(path) {
  const cfg = ghConfig();
  if (!cfg.token || !cfg.reportsOwner) throw new Error('GitHub not configured.');
  const clean = path ? `/${path.replace(/^\/+|\/+$/g, '')}` : '';
  const url = `${API}/repos/${cfg.reportsOwner}/${cfg.reportsRepo}/contents${clean}?ref=${encodeURIComponent(cfg.reportsBranch)}`;
  const res = await fetch(url, { headers: headers(cfg.token) });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`GitHub listDir ${path} failed: ${res.status}`);
  return res.json();
}

/**
 * Dispatch the Playwright deep-check workflow for a set of blocked URLs
 * (CLAUDE.md §3). Inputs must be strings, so the payload is JSON-stringified.
 */
export async function dispatchDeepCheck(inputs) {
  const cfg = ghConfig();
  if (!cfg.token || !cfg.appOwner) throw new Error('GitHub dispatch not configured.');
  const url = `${API}/repos/${cfg.appOwner}/${cfg.appRepo}/actions/workflows/${cfg.workflowFile}/dispatches`;
  const res = await fetch(url, {
    method: 'POST',
    headers: headers(cfg.token),
    body: JSON.stringify({ ref: cfg.appBranch, inputs }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub dispatch failed: ${res.status} ${text}`);
  }
  return true;
}
