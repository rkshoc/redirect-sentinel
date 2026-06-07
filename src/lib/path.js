// Client-side prediction of the archive path the background worker will write to
// (CLAUDE.md §8). LOAD-BEARING: this MUST exactly match the server's
// archivePaths() format `YYYY/MM/DD/audit_<stamp>_<safeuser>_<id>.json`, because
// the browser polls this predicted path for the result.

const p2 = (n) => String(n).padStart(2, '0');

export function predictPath(date, userLabel, id) {
  const y = date.getUTCFullYear(), m = p2(date.getUTCMonth() + 1), d = p2(date.getUTCDate());
  const stamp = `${y}-${m}-${d}T${p2(date.getUTCHours())}${p2(date.getUTCMinutes())}Z`;
  const safe = String(userLabel || 'anon').replace(/[^a-z0-9_.-]/gi, '-').toLowerCase();
  return `${y}/${m}/${d}/audit_${stamp}_${safe}_${id}.json`;
}

export function shortId() {
  const a = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 4 }, () => a[Math.floor(Math.random() * a.length)]).join('');
}
