// Report assembly, CSV serialisation, and archive paths — see CLAUDE.md §7, §8.

import { VERDICT } from './verdict.mjs';

// Pad to 2 digits.
const p2 = (n) => String(n).padStart(2, '0');

/**
 * Build the UTC date-foldered archive path + filename for an audit.
 * e.g. 2026/06/04/audit_2026-06-04T1620Z_admin_a3f9.json
 * Folder dates are UTC (region-neutral); the report metadata also keeps the
 * user's local time for display.
 */
export function archivePaths(date, user, id, ext = 'json') {
  const y = date.getUTCFullYear();
  const m = p2(date.getUTCMonth() + 1);
  const d = p2(date.getUTCDate());
  const hh = p2(date.getUTCHours());
  const mm = p2(date.getUTCMinutes());
  const safeUser = String(user || 'anon').replace(/[^a-z0-9_.-]/gi, '-').toLowerCase();
  const stamp = `${y}-${m}-${d}T${hh}${mm}Z`;
  const base = `audit_${stamp}_${safeUser}_${id}`;
  const dir = `${y}/${m}/${d}`;
  return { dir, base, json: `${dir}/${base}.json`, csv: `${dir}/${base}.csv`, stamp };
}

export function summarise(rows) {
  const s = { checked: rows.length, passed: 0, failed: 0, blocked: 0, deepChecked: 0 };
  for (const r of rows) {
    if (r.verdict === VERDICT.PASS) s.passed++;
    else if (r.verdict === VERDICT.FAIL) s.failed++;
    else if (r.verdict === VERDICT.BLOCKED) s.blocked++;
    if (r.deepChecked) s.deepChecked++;
  }
  return s;
}

// CSV-escape a single field.
function csvCell(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Serialise rows to CSV: the original sheet columns (carried through, incl.
 * ignored extras) PLUS appended verdict columns (CLAUDE.md §7).
 */
export function toCSV(report) {
  const extraKeys = [];
  for (const r of report.rows) {
    for (const k of Object.keys(r.extra || {})) if (!extraKeys.includes(k)) extraKeys.push(k);
  }
  const headerCols = ['Rule Name', 'Source URL', 'Expected Target', ...extraKeys,
    'Actual Target', 'Verdict', 'Hop Count', 'Reason'];
  const lines = [headerCols.map(csvCell).join(',')];
  for (const r of report.rows) {
    const row = [
      r.ruleName, r.source, r.expected,
      ...extraKeys.map((k) => (r.extra ? r.extra[k] : '')),
      r.finalUrl, r.verdict, r.hopCount, r.reason || '',
    ];
    lines.push(row.map(csvCell).join(','));
  }
  return lines.join('\r\n');
}
