// Client-side parsing of the rules sheet (CLAUDE.md §5).
//
// We parse .xlsx/.csv in the browser purely to drive the column-mapping
// confirmation step and to carry extra columns through. The Function still owns
// all audit logic (verdict, limits, archival). Column positions are NOT
// hardcoded — we auto-detect a best guess and let the user remap.

/* global XLSX */

// Read a File into { columns:[headerNames], rows:[[cells]] }.
export async function parseFile(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
  if (!aoa.length) return { columns: [], rows: [] };
  const columns = aoa[0].map((c, i) => (String(c).trim() || `Column ${String.fromCharCode(65 + i)}`));
  const rows = aoa.slice(1).filter((r) => r.some((c) => String(c).trim() !== ''));
  return { columns, rows };
}

// Guess which columns are rule / source / expected from their header names,
// falling back to positions A / B / C.
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

// Parse the paste textarea into a clean URL list.
export function parsePaste(text) {
  return String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}
