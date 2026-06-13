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
    // Branch to dispatch the workflow against. Left null when APP_BRANCH is
    // unset so we can auto-detect the repo's DEFAULT branch at dispatch time —
    // workflows only register from the default branch, so dispatching against
    // it is the most reliable ref (a stale APP_BRANCH=main when the default
    // branch is something else is a common, silent footgun).
    appBranch: env('APP_BRANCH') || null,
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

// The repo's DEFAULT branch, cached per process. Workflows register from the
// default branch, so it's the reliable ref to dispatch / diagnose against.
let _defaultBranch = { key: null, branch: null };
export async function repoDefaultBranch(cfg = ghConfig()) {
  if (!cfg.token || !cfg.appOwner) return null;
  const key = `${cfg.appOwner}/${cfg.appRepo}`;
  if (_defaultBranch.key === key && _defaultBranch.branch) return _defaultBranch.branch;
  try {
    const r = await fetch(`${API}/repos/${cfg.appOwner}/${cfg.appRepo}`, { headers: headers(cfg.token) });
    if (r.ok) {
      const branch = (await r.json()).default_branch || null;
      _defaultBranch = { key, branch };
      return branch;
    }
  } catch { /* best-effort */ }
  return null;
}

/**
 * The git ref to dispatch the workflow against: an explicit APP_BRANCH wins,
 * else the repo's auto-detected DEFAULT branch, with a final 'main' fallback.
 */
export async function resolveDispatchRef(cfg = ghConfig()) {
  if (cfg.appBranch) return cfg.appBranch;
  return (await repoDefaultBranch(cfg)) || 'main';
}

/**
 * Dispatch the Playwright deep-check workflow for a set of blocked URLs
 * (CLAUDE.md §3). Inputs must be strings, so the payload is JSON-stringified.
 */
export async function dispatchDeepCheck(inputs) {
  const cfg = ghConfig();
  if (!cfg.token || !cfg.appOwner) throw new Error('GitHub dispatch not configured.');
  const ref = await resolveDispatchRef(cfg);
  const url = `${API}/repos/${cfg.appOwner}/${cfg.appRepo}/actions/workflows/${cfg.workflowFile}/dispatches`;
  const res = await fetch(url, {
    method: 'POST',
    headers: headers(cfg.token),
    body: JSON.stringify({ ref, inputs }),
  });
  if (res.ok) return true;
  const text = await res.text().catch(() => '');
  // Diagnose against the ref we actually used.
  throw new Error(await explainDispatchFailure({ ...cfg, appBranch: ref }, res.status, text));
}

/**
 * Pure (no-network) builder for the ambiguous 404 case. A 404 from the
 * workflow-dispatch API means GitHub has no *registered* workflow to run, which
 * has a few distinct causes — disambiguated by how many workflows are
 * registered and the repo's default branch. Exported for unit testing.
 *
 * @param {{owner:string,repo:string,workflowFile:string,defaultBranch:(string|null),registered:(number|null)}} d
 */
export function help404({ owner, repo, workflowFile, defaultBranch, registered }) {
  const where = `${owner}/${repo}`;
  const db = defaultBranch ? `"${defaultBranch}"` : 'the repo DEFAULT branch';
  if (registered === 0) {
    // The subtle, most common cause: the file is present but was committed while
    // Actions was off, so it was never registered. Enabling Actions does NOT
    // retroactively register it — a fresh commit on the default branch does.
    return `GitHub Actions has no registered workflows for ${where}, so the deep-check can't be dispatched (404). BOTH must be true: (1) Actions is ENABLED — repo → Settings → Actions → General → "Allow all actions and reusable workflows"; (2) ${workflowFile} is committed on the DEFAULT branch (${db}). IMPORTANT: enabling Actions does NOT retroactively register a workflow that was added while Actions was off — push a fresh commit that touches ${workflowFile} on ${db} to register it, then re-run the audit.`;
  }
  if (registered > 0) {
    return `Deep-check workflow "${workflowFile}" is not among the ${registered} registered workflow(s) for ${where}. Confirm DEEPCHECK_WORKFLOW matches the filename and that ${workflowFile} is committed on the DEFAULT branch (${db}) — workflows register only from there.`;
  }
  return `GitHub Actions dispatch 404 for ${where} (workflow "${workflowFile}"): enable Actions + put ${workflowFile} on the default branch (${db}), or APP_OWNER/APP_REPO is wrong, or the token can't see the repo.`;
}

/**
 * Turn a raw dispatch failure into an actionable message.
 *  - 403 → the token lacks the `workflow` scope (classic) / Actions:write (FG).
 *  - 422 → the ref doesn't exist or has no workflow_dispatch trigger.
 *  - 404 → no registered workflow (see help404 for the disambiguation).
 */
export async function explainDispatchFailure(cfg, status, text = '') {
  const where = `${cfg.appOwner}/${cfg.appRepo} (workflow "${cfg.workflowFile}", ref "${cfg.appBranch}")`;
  if (status === 403) {
    return `GitHub Actions dispatch 403 for ${where}: the GITHUB_TOKEN lacks the "workflow" scope (classic PAT) or "Actions: read & write" (fine-grained PAT). ${text}`.trim();
  }
  if (status === 422) {
    return `GitHub Actions dispatch 422 for ${where}: branch "${cfg.appBranch}" may not exist or the workflow has no workflow_dispatch trigger on it. Set APP_BRANCH to a branch that holds ${cfg.workflowFile}. ${text}`.trim();
  }
  if (status === 404) {
    let registered = null;
    try {
      const r = await fetch(`${API}/repos/${cfg.appOwner}/${cfg.appRepo}/actions/workflows`, { headers: headers(cfg.token) });
      if (r.ok) registered = (await r.json()).total_count;
    } catch { /* best-effort diagnostic only */ }
    const defaultBranch = await repoDefaultBranch(cfg).catch(() => null);
    return help404({ owner: cfg.appOwner, repo: cfg.appRepo, workflowFile: cfg.workflowFile, defaultBranch, registered });
  }
  return `GitHub dispatch failed: ${status} ${text}`.trim();
}
