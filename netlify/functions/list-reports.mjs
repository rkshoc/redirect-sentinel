// list-reports — browse the archived audit tree for the History view
// (CLAUDE.md §8). ANY logged-in user can read ALL past reports.
//
// Without a `path` it returns the top-level years. With a path it lists that
// folder. If the folder contains an index.json (best-effort per-day index) we
// return its parsed audits so the history view shows pass/fail counts + user
// without fetching every file.

import { listDir, getFile } from './lib/github.mjs';
import { resolveIdentity } from './lib/auth.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

function safeDir(p) {
  if (!p) return '';
  if (p.includes('..') || p.startsWith('/')) return null;
  if (!/^[\d]{4}(\/[\d]{2}){0,2}$/.test(p)) return null; // YYYY[/MM[/DD]]
  return p;
}

export default async (req, context) => {
  // History browsing requires login (CLAUDE.md §4); read is tier-independent.
  const identity = resolveIdentity(context.clientContext);
  if (!identity.loggedIn) return json({ error: 'login required to browse history' }, 401);

  const url = new URL(req.url);
  const dir = safeDir(url.searchParams.get('path'));
  if (dir === null) return json({ error: 'invalid path' }, 400);

  let entries;
  try {
    entries = await listDir(dir);
  } catch (e) {
    return json({ error: e.message }, 500);
  }

  // At day level, prefer the index if present.
  const isDayLevel = /^\d{4}\/\d{2}\/\d{2}$/.test(dir);
  if (isDayLevel) {
    const idx = entries.find((e) => e.name === 'index.json');
    if (idx) {
      try {
        const file = await getFile(`${dir}/index.json`);
        if (file) return json({ dir, kind: 'audits', audits: JSON.parse(file.content).audits || [] });
      } catch { /* fall through to raw listing */ }
    }
    // No index — list the .json audit files directly.
    const audits = entries
      .filter((e) => e.type === 'file' && e.name.endsWith('.json') && e.name !== 'index.json' && !e.name.endsWith('.deepcheck.json'))
      .map((e) => ({ file: `${dir}/${e.name}`, name: e.name.replace(/\.json$/, '') }));
    return json({ dir, kind: 'audits', audits });
  }

  // Folder level (years/months/days).
  const folders = entries
    .filter((e) => e.type === 'dir')
    .map((e) => ({ name: e.name, path: dir ? `${dir}/${e.name}` : e.name }))
    .sort((a, b) => (a.name < b.name ? 1 : -1));
  return json({ dir, kind: 'folders', folders });
};
