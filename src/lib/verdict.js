// Verdict model + grid logic — ported verbatim from legacy/js/render.js so the
// strict pass/fail semantics, failures-first default sort, filter predicates,
// and hop-chain display are identical (CLAUDE.md §6, §7).

export const SERVER_LABEL = {
  akamai: 'Akamai edge',
  dispatcher: 'AEM dispatcher',
  origin: 'AEM publish',
  unknown: 'origin · masked',
};

// Failures-first ordering rank.
export const VRANK = { FAIL: 0, BLOCKED: 1, INFO: 2, PASS: 3 };

// label + tone (tone maps to the verdict color tokens pass/fail/blocked/info).
export const VMETA = {
  PASS: { label: 'Pass', tone: 'pass', glyph: '✓' },
  FAIL: { label: 'Fail', tone: 'fail', glyph: '✕' },
  BLOCKED: { label: 'Blocked', tone: 'blocked', glyph: '◷' },
  INFO: { label: 'Traced', tone: 'info', glyph: '•' },
};

export const totalMs = (r) => (r.hops || []).reduce((a, h) => a + (h.timeMs || 0), 0);

// Grid columns. `get` returns the sort value; `num` sorts numerically + right-aligns.
export const COLS = [
  { key: 'rule', label: 'Rule', get: (r) => r.ruleName || '' },
  { key: 'source', label: 'Source', get: (r) => r.source || '' },
  { key: 'expected', label: 'Target', get: (r) => r.expected || '' },
  { key: 'final', label: 'Final', get: (r) => r.finalUrl || '' },
  { key: 'verdict', label: 'Verdict', get: (r) => VRANK[r.verdict] ?? 9, num: true },
  { key: 'hops', label: 'Hops', get: (r) => r.hopCount || 0, num: true },
  { key: 'ms', label: 'ms', get: (r) => totalMs(r), num: true },
];

// Per-verdict explanation for the expanded detail. Returns { tone, text } where
// text is plain (expected/got are rendered separately by the component).
export function reasonInfo(row) {
  const v = row.verdict;
  if (v === 'PASS') return { tone: 'ok', text: 'Exact match. Final URL equals expected target.' };
  if (v === 'BLOCKED') return { tone: 'info', text: `WAF-blocked / inconclusive — not counted as a failure.${row.deepPending ? ' Re-running via Playwright from a different IP.' : ''}` };
  if (v === 'INFO') return { tone: 'info', text: 'Traced (paste mode) — no expected target to compare against.' };
  switch (row.reason) {
    case 'real mismatch':
      return { tone: 'bad', text: 'Real mismatch — landed on a different path than the spec.' };
    case 'trivial difference':
      return { tone: 'warn', text: 'Trivial difference only — differs by slash / case / protocol / www / query. Strict mode marks this FAIL.' };
    case 'no redirect':
      return { tone: 'bad', text: "No redirect — source returned 200 directly. The rule isn't firing." };
    case 'broken':
      return { tone: 'bad', text: `Broken — chain ends in ${row.finalStatus}. The target is dead.` };
    case 'loop / too many hops':
      return { tone: 'bad', text: 'Redirect loop / too many hops.' };
    default:
      return { tone: 'bad', text: 'Final URL differs from expected.' };
  }
}

export function matchesFilter(row, { filter, query }) {
  if (filter === 'fail' && row.verdict !== 'FAIL') return false;
  if (filter === 'blocked' && row.verdict !== 'BLOCKED') return false;
  if (filter === '302' && !(row.hops || []).some((h) => h.status === 302 || h.status === 307)) return false;
  if (filter === 'long' && (row.hopCount || 0) <= 2) return false;
  if (query) {
    const hay = `${row.ruleName} ${row.source} ${row.expected || ''} ${row.finalUrl || ''}`.toLowerCase();
    if (!hay.includes(query)) return false;
  }
  return true;
}

export function sortFailuresFirst(rows) {
  return [...rows].sort((a, b) => VRANK[a.verdict] - VRANK[b.verdict]);
}

// sortKey null → failures-first default; else sort by the column accessor.
export function sortRows(rows, { sortKey, sortDir }) {
  if (!sortKey) return sortFailuresFirst(rows);
  const col = COLS.find((c) => c.key === sortKey);
  if (!col) return rows;
  return [...rows].sort((a, b) => {
    const va = col.get(a), vb = col.get(b);
    if (col.num) return (va - vb) * sortDir;
    return String(va).toLowerCase().localeCompare(String(vb).toLowerCase()) * sortDir;
  });
}
