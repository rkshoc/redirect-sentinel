// list-all-reports — flat list of ALL archived audits for the redesigned
// History grid (CLAUDE.md §8). ANY logged-in user can read ALL past reports.
//
// Walks the UTC date tree (YYYY/MM/DD) and aggregates each day's best-effort
// index.json (the exact shape audit-background.updateDayIndex writes). Days
// without an index fall back to a raw .json listing (no summary metadata).
// Bounded by ?days= (how many recent day-folders to scan) and ?limit= (audits
// returned) so a large archive never fans out unboundedly.

import { listDir, getFile } from './lib/github.mjs';
import { resolveIdentity } from './lib/auth.mjs';

const json = (body, status = 200) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

const dirsDesc = (entries, re) => entries
  .filter((e) => e.type === 'dir' && re.test(e.name))
  .map((e) => e.name)
  .sort()
  .reverse();

// Collect one day's audits, preferring the per-day index.json.
async function collectDay(dir) {
  try {
    const idx = await getFile(`${dir}/index.json`).catch(() => null);
    if (idx) {
      const parsed = JSON.parse(idx.content);
      return (parsed.audits || []).map((a) => {
        const file = a.file && a.file.includes('/') ? a.file : `${dir}/${a.file}`;
        return {
          file,
          name: a.name || (a.file || '').replace(/^.*\//, '').replace(/\.json$/, ''),
          id: a.id,
          user: a.user,
          createdUtc: a.createdUtc,
          summary: a.summary,
          status: a.status,
          day: dir,
        };
      });
    }
    // No index — list raw audit files (no summary metadata available).
    const entries = await listDir(dir);
    return entries
      .filter((e) => e.type === 'file' && e.name.endsWith('.json') && e.name !== 'index.json' && !e.name.endsWith('.deepcheck.json'))
      .map((e) => ({ file: `${dir}/${e.name}`, name: e.name.replace(/\.json$/, ''), day: dir }));
  } catch {
    return []; // a single bad day must never break the whole list
  }
}

export const handler = async (event, context) => {
  // History browsing requires login (CLAUDE.md §4); read is tier-independent.
  const identity = resolveIdentity(context.clientContext);
  if (!identity.loggedIn) return json({ error: 'login required to browse history' }, 401);

  const q = event.queryStringParameters || {};
  const limit = Math.min(Math.max(Number(q.limit) || 500, 1), 2000);
  const maxDays = Math.min(Math.max(Number(q.days) || 180, 1), 3650);

  let dayPaths;
  try {
    const years = dirsDesc(await listDir(''), /^\d{4}$/);
    dayPaths = [];
    outer: for (const y of years) {
      const months = dirsDesc(await listDir(y), /^\d{2}$/);
      for (const m of months) {
        const days = dirsDesc(await listDir(`${y}/${m}`), /^\d{2}$/);
        for (const d of days) {
          dayPaths.push(`${y}/${m}/${d}`);
          if (dayPaths.length >= maxDays) break outer;
        }
      }
    }
  } catch (e) {
    return json({ error: e.message }, 500);
  }

  const perDay = await Promise.all(dayPaths.map(collectDay));
  let audits = perDay.flat();
  audits.sort((a, b) => ((a.createdUtc || a.day || '') < (b.createdUtc || b.day || '') ? 1 : -1));

  const total = audits.length;
  const truncated = total > limit;
  if (truncated) audits = audits.slice(0, limit);
  return json({ kind: 'audits', audits, total, truncated, scannedDays: dayPaths.length });
};
