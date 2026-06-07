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

// Resolve one file's column indices for the shared mapping, matching by HEADER
// NAME first (handles reordered columns across files), falling back to the
// reference index when the name isn't found.
export function resolveFileMapping(refColumns, refMapping, fileColumns) {
  const out = {};
  for (const role of ['ruleName', 'source', 'expected']) {
    const idx = refMapping[role];
    if (idx == null) { out[role] = null; continue; }
    const name = String(refColumns[idx] ?? '').trim().toLowerCase();
    let fi = fileColumns.findIndex((c) => String(c).trim().toLowerCase() === name);
    if (fi === -1) fi = idx < fileColumns.length ? idx : null;
    out[role] = fi;
  }
  return out;
}

// Count auditable rows in one file under the shared mapping.
export function countFileRows(file, refColumns, refMapping) {
  const fm = resolveFileMapping(refColumns, refMapping, file.sheet.columns);
  if (fm.source == null) return 0;
  const hasExp = refMapping.expected != null;
  return file.sheet.rows.filter((r) => {
    if (String(r[fm.source] ?? '').trim() === '') return false;
    if (hasExp && String(r[fm.expected] ?? '').trim() === '') return false;
    return true;
  }).length;
}

/**
 * Merge one or more parsed files into a single synthetic sheet the server can
 * consume UNCHANGED (columns + mapping indices + rows). Each row is normalised
 * to [Rule Name, Source URL, (Expected Target,) ...extras, (Source File)].
 * Returns { sheet:{columns,rows}, mapping }. The mapping always points rule→0,
 * source→1, expected→2|null, so the worker carries the rest as `extra`.
 */
export function combineSheets(files, refMapping) {
  const ref = files[0];
  const hasExpected = refMapping.expected != null;
  const multi = files.length > 1;

  // Union of extra column NAMES (original order), i.e. every column that isn't
  // one of the three mapped roles in that file.
  const extraKeys = [];
  for (const f of files) {
    const fm = resolveFileMapping(ref.sheet.columns, refMapping, f.sheet.columns);
    f.sheet.columns.forEach((c, i) => {
      if (i === fm.ruleName || i === fm.source || i === fm.expected) return;
      const name = String(c).trim() || `Column ${i + 1}`;
      if (!extraKeys.includes(name)) extraKeys.push(name);
    });
  }

  const rows = [];
  for (const f of files) {
    const fm = resolveFileMapping(ref.sheet.columns, refMapping, f.sheet.columns);
    if (fm.source == null) continue;
    for (const r of f.sheet.rows) {
      if (String(r[fm.source] ?? '').trim() === '') continue;
      if (hasExpected && String(r[fm.expected] ?? '').trim() === '') continue;
      const rec = [fm.ruleName == null ? '' : (r[fm.ruleName] ?? ''), r[fm.source] ?? ''];
      if (hasExpected) rec.push(r[fm.expected] ?? '');
      for (const k of extraKeys) {
        const ci = f.sheet.columns.findIndex((c) => (String(c).trim() || '') === k);
        rec.push(ci === -1 ? '' : (r[ci] ?? ''));
      }
      if (multi) rec.push(f.name);
      rows.push(rec);
    }
  }

  const columns = ['Rule Name', 'Source URL'];
  if (hasExpected) columns.push('Expected Target');
  columns.push(...extraKeys);
  if (multi) columns.push('Source File');
  const mapping = { ruleName: 0, source: 1, expected: hasExpected ? 2 : null };
  return { sheet: { columns, rows }, mapping };
}
