// Report rendering — summary headline, filterable failures-first table,
// per-row expected-vs-actual diff + hop chain (CLAUDE.md §7). Mirrors the
// approved mockup's verdict model.

import { exportExcel, exportJSON } from './export.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SERVER_LABEL = { akamai: 'Akamai edge', dispatcher: 'AEM dispatcher', origin: 'AEM publish', unknown: 'origin · masked' };

let current = null;       // the report being shown
let filter = 'all';       // active filter chip
let query = '';           // search text
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

function rowEl(row) {
  if (row.deepPending && row.verdict === 'BLOCKED') {
    return `<div class="res pending"><div class="rhead">
      <span class="vtag blocked">◷ DEEP-CHECK</span>
      <span class="rname"><div class="rule">${esc(row.ruleName || row.source)}</div>
      <div class="src">${esc(row.source)} · WAF 403 → re-running via Playwright</div></span>
      <span class="rmeta"><span class="spin"></span><span class="mini">~1 min</span></span></div></div>`;
  }
  const vclass = row.verdict.toLowerCase();
  const vlabel = { PASS: '✓ PASS', FAIL: '✕ FAIL', BLOCKED: '◷ BLOCKED', INFO: '• TRACED' }[row.verdict];
  const srcLine = row.expected
    ? `${esc(row.source)} → expected ${esc(row.expected)}`
    : esc(row.source);
  const metas = [
    `<span class="mini">${row.hopCount} hop${row.hopCount === 1 ? '' : 's'}</span>`,
    row.reason ? `<span class="mini">${esc(row.reason)}</span>` : (row.deepChecked ? `<span class="mini">deep-checked</span>` : ''),
  ].join('');
  const good = row.verdict === 'PASS';
  const cmp = row.expected ? `<div class="cmp">
      <div class="box exp"><div class="bl">Expected</div><div class="bv">${esc(row.expected)}</div></div>
      <div class="box got ${good ? 'good' : 'bad'}"><div class="bl">Actual final</div><div class="bv">${esc(row.finalUrl)}${row.finalStatus && row.verdict === 'FAIL' && row.reason === 'broken' ? ' · ' + esc(row.finalStatus) : ''}</div></div>
    </div>` : '';
  return `<div class="res ${vclass}"><div class="rhead" data-tog>
      <span class="vtag ${vclass}">${vlabel}</span>
      <span class="rname"><div class="rule">${esc(row.ruleName || '(no rule name)')}</div><div class="src">${srcLine}</div></span>
      <span class="rmeta">${metas}<span class="chev">▶</span></span></div>
    <div class="detail">${reasonBlock(row)}${cmp}${hopChain(row.hops)}</div></div>`;
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
  const rank = { FAIL: 0, BLOCKED: 1, INFO: 2, PASS: 3 };
  return [...rows].sort((a, b) => (rank[a.verdict] - rank[b.verdict]));
}

export function renderReport(report, mount) {
  // Reset filter/search/pagination only when a different report is loaded
  // (re-renders for paging/filtering pass the same `current` object).
  if (report !== current) { current = report; filter = 'all'; query = ''; shown = PAGE; }
  const s = report.summary || { checked: 0, passed: 0, failed: 0, blocked: 0, deepChecked: 0 };
  const counts = {
    all: report.rows.length,
    fail: report.rows.filter((r) => r.verdict === 'FAIL').length,
    blocked: report.rows.filter((r) => r.verdict === 'BLOCKED').length,
  };
  const partial = report.status === 'partial';

  mount.innerHTML = `
    ${partial ? `<div class="banner ok show">Partial report — ${report.deepCheck?.pending || 0} URL(s) re-running via Playwright. This view refreshes automatically.</div>` : ''}
    <div class="sumgrid">
      <div class="stat n"><div class="n">${s.checked}</div><div class="l">Rules checked</div></div>
      <div class="stat p"><div class="n" style="color:var(--pass)">${s.passed}</div><div class="l">Passed</div></div>
      <div class="stat f"><div class="n" style="color:var(--fail)">${s.failed}</div><div class="l">Failed</div></div>
      <div class="stat b"><div class="n" style="color:var(--blocked)">${s.blocked}</div><div class="l">Blocked</div></div>
      <div class="stat t"><div class="n" style="color:var(--info)">${s.deepChecked}</div><div class="l">Deep-checked</div></div>
    </div>
    <div class="fbar">
      <span class="chip ${filter === 'all' ? 'on' : ''}" data-f="all">All (${counts.all})</span>
      <span class="chip ${filter === 'fail' ? 'on' : ''}" data-f="fail">Failures first (${counts.fail})</span>
      <span class="chip ${filter === 'blocked' ? 'on' : ''}" data-f="blocked">Blocked (${counts.blocked})</span>
      <span class="chip ${filter === '302' ? 'on' : ''}" data-f="302">302 present</span>
      <span class="chip ${filter === 'long' ? 'on' : ''}" data-f="long">Chains &gt; 2 hops</span>
      <input class="search" id="searchBox" placeholder="search rule / url…" value="${esc(query)}">
    </div>
    <div style="display:flex;gap:9px;margin-bottom:14px;flex-wrap:wrap">
      <button class="exp" id="expandAll">Expand all</button>
      <button class="exp" id="expXlsx">⬇ Export Excel (+ verdict cols)</button>
      <button class="exp" id="expJson">⬇ Export JSON</button>
      <span class="hint" style="margin-left:auto;align-self:center">archived → ${esc(report.filename || '')}</span>
    </div>
    <div id="rows"></div>
    <div id="more"></div>`;

  const visible = sortFailuresFirst(report.rows.filter(matchesFilter));
  const page = visible.slice(0, shown);
  const rowsEl = mount.querySelector('#rows');
  rowsEl.innerHTML = page.length ? page.map(rowEl).join('') : `<div class="empty">No rows match this filter.</div>`;

  // "Show more" for large result sets — render in pages so thousands of rows
  // don't all hit the DOM at once.
  const moreEl = mount.querySelector('#more');
  if (visible.length > shown) {
    const remaining = visible.length - shown;
    moreEl.innerHTML = `<div style="text-align:center;margin:8px 0 4px">
      <button class="exp" id="showMore">Show ${Math.min(PAGE, remaining)} more · ${remaining} hidden</button></div>`;
    moreEl.querySelector('#showMore').addEventListener('click', () => { shown += PAGE; renderReport(current, mount); });
  } else {
    moreEl.innerHTML = '';
  }

  // wire interactions
  mount.querySelectorAll('[data-tog]').forEach((h) => h.addEventListener('click', () => {
    h.classList.toggle('open');
    h.nextElementSibling.classList.toggle('show');
  }));
  mount.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => {
    filter = c.dataset.f; shown = PAGE; renderReport(current, mount);
  }));
  const search = mount.querySelector('#searchBox');
  search.addEventListener('input', () => { query = search.value.toLowerCase(); shown = PAGE; renderReport(current, mount); search.focus(); });
  mount.querySelector('#expandAll').addEventListener('click', () => {
    mount.querySelectorAll('[data-tog]').forEach((h) => { h.classList.add('open'); h.nextElementSibling.classList.add('show'); });
  });
  mount.querySelector('#expXlsx').addEventListener('click', () => exportExcel(current));
  mount.querySelector('#expJson').addEventListener('click', () => exportJSON(current));
}
