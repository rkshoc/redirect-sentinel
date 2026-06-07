// Client-side parsing of the rules sheet (CLAUDE.md §5). Parses .xlsx/.csv purely
// to drive the column-mapping step + carry extras through; the Function owns all
// audit logic. SheetJS (xlsx) is large, so it's dynamically imported (lazy chunk).

export async function parseFile(file) {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
  if (!aoa.length) return { columns: [], rows: [] };
  const columns = aoa[0].map((c, i) => (String(c).trim() || `Column ${String.fromCharCode(65 + i)}`));
  const rows = aoa.slice(1).filter((r) => r.some((c) => String(c).trim() !== ''));
  return { columns, rows };
}

// Guess rule/source/expected columns from header names, falling back to A/B/C.
export function detectMapping(columns) {
  const norm = columns.map((c) => String(c).toLowerCase());
  const find = (res, fallback) => {
    for (const re of res) {
      const i = norm.findIndex((c) => re.test(c));
      if (i !== -1) return i;
    }
    return fallback < columns.length ? fallback : null;
  };
  const ruleName = find([/rule/, /\bname\b/, /\bid\b/], 0);
  const source = find([/source/, /match.?url/, /\bmatch\b/, /\bfrom\b/, /\bold\b/, /request|origin.?url/, /^url$/], 1);
  const expected = find([/expected/, /redirect.?url/, /target/, /destination/, /\bto\b/, /\bnew\b/, /redirect to/], 2);
  return { ruleName, source, expected };
}

export function parsePaste(text) {
  return String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

// Auditable rows: mapped Source (and Expected when mapped) are non-empty.
export function auditableRows(sheet, mapping) {
  if (!sheet) return [];
  const m = mapping;
  if (m == null || m.source == null) return [];
  return sheet.rows.filter((r) => {
    if (String(r[m.source] ?? '').trim() === '') return false;
    if (m.expected != null && String(r[m.expected] ?? '').trim() === '') return false;
    return true;
  });
}
