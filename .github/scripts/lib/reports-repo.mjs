// Minimal GitHub Contents-API helpers for the Actions scripts to read the audit
// input and write the report back to the reports repo. Uses the REPORTS_TOKEN
// PAT (the job's GITHUB_TOKEN can't write to a separate repo). Plain fetch.

const API = 'https://api.github.com';

const {
  REPORTS_TOKEN, REPORTS_OWNER, REPORTS_REPO, REPORTS_BRANCH = 'main',
} = process.env;

function ghHeaders() {
  return {
    Authorization: `Bearer ${REPORTS_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'redirect-sentinel-audit',
    'Content-Type': 'application/json',
  };
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

/** Read + parse a JSON file from the reports repo. */
export async function getJson(path) {
  const url = `${API}/repos/${REPORTS_OWNER}/${REPORTS_REPO}/contents/${path}?ref=${encodeURIComponent(REPORTS_BRANCH)}`;
  const res = await fetch(url, { headers: ghHeaders() });
  if (!res.ok) throw new Error(`getJson ${path}: ${res.status} ${await res.text().catch(() => '')}`);
  const j = await res.json();
  return JSON.parse(Buffer.from(j.content, 'base64').toString('utf8'));
}

/** Get the current blob SHA for a path, or null if it doesn't exist. */
export async function getSha(path) {
  const url = `${API}/repos/${REPORTS_OWNER}/${REPORTS_REPO}/contents/${path}?ref=${encodeURIComponent(REPORTS_BRANCH)}`;
  const res = await fetch(url, { headers: ghHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`getSha ${path}: ${res.status}`);
  return (await res.json()).sha || null;
}

/** Write a text/JSON file. Pass overwrite:true to update an existing path. */
export async function putContent(path, content, message, { overwrite = false } = {}) {
  const body = { message, content: b64(content), branch: REPORTS_BRANCH };
  if (overwrite) {
    const sha = await getSha(path).catch(() => null);
    if (sha) body.sha = sha;
  }
  const url = `${API}/repos/${REPORTS_OWNER}/${REPORTS_REPO}/contents/${path}`;
  const res = await fetch(url, { method: 'PUT', headers: ghHeaders(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`putContent ${path}: ${res.status} ${await res.text().catch(() => '')}`);
  return res.json();
}

export const putJson = (path, obj, message, opts) => putContent(path, JSON.stringify(obj, null, 2), message, opts);

/**
 * Best-effort per-day index update for the History view (CLAUDE.md §8). Mirrors
 * the shape the Netlify worker writes. Index write races must never break an
 * audit, so callers should swallow errors.
 */
export async function updateDayIndex(dir, entry) {
  const indexPath = `${dir}/index.json`;
  let index = { day: dir, audits: [] };
  try { index = await getJson(indexPath); } catch { /* fresh */ }
  index.audits = (index.audits || []).filter((a) => a.file !== entry.file);
  index.audits.push(entry);
  index.audits.sort((a, b) => (a.createdUtc < b.createdUtc ? 1 : -1));
  await putJson(indexPath, index, `index ${dir}`, { overwrite: true });
}
