// Report rendering — data-dense sortable grid (CLAUDE.md §7). A compact summary
// strip, filter chips + search, then a spreadsheet-style table with a sticky
// header and click-to-sort columns. Each row expands in place to show the
// expected-vs-actual diff + full hop chain. Verdict model unchanged.

import { exportExcel, exportJSON } from './export.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SERVER_LABEL = { akamai: 'Akamai edge', dispatcher: 'AEM dispatcher', origin: 'AEM publish', unknown: 'origin · masked' };
const VRANK = { FAIL: 0, BLOCKED: 1, INFO: 2, PASS: 3 };
const VMETA = {
  PASS: { c: 'pass', t: '✓ Pass' }, FAIL: { c: 'fail', t: '✕ Fail' },
  BLOCKED: { c: 'blocked', t: '◷ Blocked' }, INFO: { c: 'info', t: '• Traced' },
};
const totalMs = (r) => (r.hops || []).reduce((a, h) => a + (h.timeMs || 0), 0);

// Grid columns. `get` returns the value used for sorting; cells are rendered
// per-type in rowEl. `num` right-aligns and sorts numerically.
const COLS = [
  { key: 'rule', label: 'Rule', get: (r) => r.ruleName || '' },
  { key: 'source', label: 'Source', get: (r) => r.source || '' },
  { key: 'expected', label: 'Target', get: (r) => r.expected || '' },
  { key: 'final', label: 'Final', get: (r) => r.finalUrl || '' },
  { key: 'verdict', label: 'Verdict', get: (r) => VRANK[r.verdict] ?? 9, num: true },
  { key: 'hops', label: 'Hops', get: (r) => r.hopCount || 0, num: true },
  { key: 'ms', label: 'ms', get: (r) => totalMs(r), num: true },
];

let current = null;       // the report being shown
let filter = 'all';       // active filter chip
let query = '';           // search text
let sortKey = null;       // active sort column (null = failures-first default)
let sortDir = 1;          // 1 asc, -1 desc
const PAGE = 100;         // rows rendered per "page" (large audits can be huge)
let shown = PAGE;         // how many filtered rows are currently rendered

function reasonBlock(row) {
  const v = row.verdict;
  if (v === 'PASS') return `<div class="reason ok">✓ Exact match. Final URL equals expected target.</div>`;
  if (v === 'BLOCKED') return `<div class="reason info">◷ WAF-blocked / inconclusive — not counted as a failure.${row.deepPending ? ' Re-running via Playwright from a different IP.' : ''}</div>`;
  if (v === 'INFO') return `<div class="reason info">Traced (paste mode) — no expected target to compare against.</div>`;
  // FAIL variants
  const exp = esc(row.expected), got = esc(row.finalUrl);
  switch (row.reason) {
    case 'real mismatch':
      return `<div class="reason bad">⚠ Real mismatch — landed on a different path than the spec. Expected <b>${exp}</b>, got <b>${got}</b>.</div>`;
    case 'trivial difference':
      return `<div class="reason warn">Trivial difference only — differs by slash / case / protocol / www / query. Expected <b>${exp}</b>, got <b>${got}</b>. Strict mode marks this FAIL.</div>`;
    case 'no redirect':
      return `<div class="reason bad">⚠ No redirect — source returned 200 directly. The rule isn't firing.</div>`;
    case 'broken':
      return `<div class="reason bad">⚠ Broken — chain ends in <b>${esc(row.finalStatus)}</b>. The target is dead.</div>`;
    case 'loop / too many hops':
      return `<div class="reason bad">⚠ Redirect loop / too many hops.</div>`;
    default:
      return `<div class="reason bad">⚠ Final URL differs from expected.</div>`;
  }
}

function hopChain(hops) {
  if (!hops || !hops.length) return '';
  const rows = hops.map((h, i) => {
    const isLast = i === hops.length - 1;
    const sc = h.status ? `<span class="b s${h.status}">${h.status}</span>` : `<span class="b s500">${esc(h.error || 'err')}</span>`;
    const srv = `<span class="srv ${esc(h.server)}">${esc(SERVER_LABEL[h.server] || h.server)}</span>`;
    const arrow = i > 0 ? `<span class="ar">↳</span>` : '';
    const fin = isLast ? ` <span style="color:var(--faint)">(final)</span>` : '';
    return `<div class="hop"><div class="hopn">${h.n}</div><div class="hopbody">
      <div class="hu">${arrow}${esc(h.url)}${fin}</div>
      <div class="hb">${sc}${srv}<span class="tm">${h.timeMs}ms</span></div></div></div>`;
  }).join('');
  return `<div class="chaintitle">Hop chain</div>${rows}`;
}

const ucell = (url) => (url ? `<span class="u" title="${esc(url)}">${esc(url)}</span>` : `<span class="dim">—</span>`);

function rowEl(row) {
  // Deep-check still pending — show a live spinner row, no expandable detail yet.
  if (row.deepPending && row.verdict === 'BLOCKED') {
    return `<tr class="row v-blocked"><td class="cRule"><span class="u" title="${esc(row.ruleName || row.source)}">${esc(row.ruleName || row.source)}</span></td>
      <td>${ucell(row.source)}</td><td class="dim">—</td><td class="dim">re-running via Playwright…</td>
      <td><span class="vtag blocked"><span class="spin"></span> Deep-check</span></td>
      <td class="num">${row.hopCount || 0}</td><td class="num dim">—</td></tr>`;
  }
  const vclass = row.verdict.toLowerCase();
  const m = VMETA[row.verdict] || { c: 'info', t: row.verdict };
  const vsub = row.verdict === 'FAIL' && row.reason
    ? `<div class="vsub">${esc(row.reason)}</div>`
    : (row.deepChecked ? `<div class="vsub dim">deep-checked</div>` : '');
  const good = row.verdict === 'PASS';
  const cmp = row.expected ? `<div class="cmp">
      <div class="box exp"><div class="bl">Expected</div><div class="bv">${esc(row.expected)}</div></div>
      <div class="box got ${good ? 'good' : 'bad'}"><div class="bl">Actual final</div><div class="bv">${esc(row.finalUrl)}${row.finalStatus && row.verdict === 'FAIL' && row.reason === 'broken' ? ' · ' + esc(row.finalStatus) : ''}</div></div>
    </div>` : '';
  const tr = `<tr class="row v-${vclass}" data-tog>
      <td class="cRule"><span class="u rule" title="${esc(row.ruleName || '(no rule name)')}">${esc(row.ruleName || '(no rule name)')}</span></td>
      <td>${ucell(row.source)}</td>
      <td>${row.expected ? ucell(row.expected) : '<span class="dim">—</span>'}</td>
      <td>${ucell(row.finalUrl)}</td>
      <td><span class="vtag ${m.c}">${m.t}</span>${vsub}</td>
      <td class="num">${row.hopCount || 0}</td>
      <td class="num">${totalMs(row)}</td></tr>`;
  const detail = `<tr class="detailrow"><td colspan="7"><div class="detailwrap">${reasonBlock(row)}${cmp}${hopChain(row.hops)}</div></td></tr>`;
  return tr + detail;
}

function matchesFilter(row) {
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

function sortFailuresFirst(rows) {
  return [...rows].sort((a, b) => (VRANK[a.verdict] - VRANK[b.verdict]));
}

function sortRows(rows) {
  if (!sortKey) return sortFailuresFirst(rows); // default view
  const col = COLS.find((c) => c.key === sortKey);
  return [...rows].sort((a, b) => {
    const va = col.get(a), vb = col.get(b);
    if (col.num) return (va - vb) * sortDir;
    return String(va).toLowerCase().localeCompare(String(vb).toLowerCase()) * sortDir;
  });
}

function headerCell(c) {
  const active = sortKey === c.key;
  const ind = active ? (sortDir > 0 ? '▲' : '▼') : '↕';
  return `<th data-k="${c.key}" class="${c.num ? 'num' : ''}${active ? ' active' : ''}">${c.label}<span class="sort">${ind}</span></th>`;
}

export function renderReport(report, mount) {
  // Reset filter/search/sort/pagination only when a different report is loaded
  // (re-renders for paging/sorting/filtering pass the same `current` object).
  if (report !== current) { current = report; filter = 'all'; query = ''; sortKey = null; sortDir = 1; shown = PAGE; }
  const s = report.summary || { checked: 0, passed: 0, failed: 0, blocked: 0, deepChecked: 0 };
  const counts = {
    all: report.rows.length,
    fail: report.rows.filter((r) => r.verdict === 'FAIL').length,
    blocked: report.rows.filter((r) => r.verdict === 'BLOCKED').length,
  };
  const partial = report.status === 'partial';

  mount.innerHTML = `
    ${partial ? `<div class="banner ok show">Partial report — ${report.deepCheck?.pending || 0} URL(s) re-running via Playwright. This view refreshes automatically.</div>` : ''}
    <div class="sumbar">
      <span class="sb"><b>${s.checked}</b> checked</span>
      <span class="sb p"><b style="color:var(--pass)">${s.passed}</b> passed</span>
      <span class="sb f"><b style="color:var(--fail)">${s.failed}</b> failed</span>
      <span class="sb b"><b style="color:var(--blocked)">${s.blocked}</b> blocked</span>
      <span class="sb t"><b style="color:var(--info)">${s.deepChecked}</b> deep-checked</span>
      ${report.filename ? `<span class="sb arch" title="${esc(report.filename)}">archived ✓</span>` : ''}
    </div>
    <div class="fbar">
      <span class="chip ${filter === 'all' ? 'on' : ''}" data-f="all">All (${counts.all})</span>
      <span class="chip ${filter === 'fail' ? 'on' : ''}" data-f="fail">Failures (${counts.fail})</span>
      <span class="chip ${filter === 'blocked' ? 'on' : ''}" data-f="blocked">Blocked (${counts.blocked})</span>
      <span class="chip ${filter === '302' ? 'on' : ''}" data-f="302">302 present</span>
      <span class="chip ${filter === 'long' ? 'on' : ''}" data-f="long">Chains &gt; 2 hops</span>
      <input class="search" id="searchBox" placeholder="search rule / url…" value="${esc(query)}">
    </div>
    <div class="tbar">
      <button class="exp" id="expandAll">⤢ Expand all</button>
      <button class="exp" id="expXlsx">⬇ Excel (full hop chain)</button>
      <button class="exp" id="expJson">⬇ JSON</button>
      <span class="hint" id="rowcount"></span>
    </div>
    <div class="gridwrap">
      <table class="grid">
        <thead><tr>${COLS.map(headerCell).join('')}</tr></thead>
        <tbody id="gbody"></tbody>
      </table>
    </div>
    <div id="more"></div>`;

  const visible = sortRows(report.rows.filter(matchesFilter));
  const page = visible.slice(0, shown);
  const body = mount.querySelector('#gbody');
  body.innerHTML = page.length ? page.map(rowEl).join('') : `<tr><td colspan="7" class="gempty">No rows match this filter.</td></tr>`;
  mount.querySelector('#rowcount').textContent = `${Math.min(shown, visible.length)} of ${visible.length} shown`;

  // "Show more" for large result sets — render in pages so thousands of rows
  // don't all hit the DOM at once.
  const moreEl = mount.querySelector('#more');
  if (visible.length > shown) {
    const remaining = visible.length - shown;
    moreEl.innerHTML = `<div class="morewrap"><button class="exp" id="showMore">Show ${Math.min(PAGE, remaining)} more · ${remaining} hidden</button></div>`;
    moreEl.querySelector('#showMore').addEventListener('click', () => { shown += PAGE; renderReport(current, mount); });
  } else {
    moreEl.innerHTML = '';
  }

  // wire interactions
  body.querySelectorAll('tr.row[data-tog]').forEach((tr) => tr.addEventListener('click', () => {
    tr.classList.toggle('open');
    const d = tr.nextElementSibling;
    if (d && d.classList.contains('detailrow')) d.classList.toggle('show');
  }));
  mount.querySelectorAll('th[data-k]').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.k;
    if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = 1; }
    renderReport(current, mount);
  }));
  mount.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => {
    filter = c.dataset.f; shown = PAGE; renderReport(current, mount);
  }));
  const search = mount.querySelector('#searchBox');
  search.addEventListener('input', () => { query = search.value.toLowerCase(); shown = PAGE; renderReport(current, mount); search.focus(); });
  mount.querySelector('#expandAll').addEventListener('click', () => {
    body.querySelectorAll('tr.row[data-tog]').forEach((tr) => {
      tr.classList.add('open');
      const d = tr.nextElementSibling;
      if (d && d.classList.contains('detailrow')) d.classList.add('show');
    });
  });
  mount.querySelector('#expXlsx').addEventListener('click', () => exportExcel(current));
  mount.querySelector('#expJson').addEventListener('click', () => exportJSON(current));
}
