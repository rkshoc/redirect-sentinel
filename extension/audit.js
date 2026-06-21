/* Redirect Sentinel — Chrome extension audit page.
 * Talks to a deployed Redirect Sentinel: POST /api/audit-dispatch fires the
 * Playwright-on-Actions engine, then we poll /api/report for the result. Auth is
 * Netlify Identity (gotrue) for the >10-URL tiers; <=10 works anonymously. */

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ANON_LIMIT = 10;

let store = { baseUrl: '', auth: null }; // auth: { access_token, refresh_token, expires_at, email }
let sheet = null;       // { columns, rows } from an uploaded file
let lastReport = null;  // last rendered report (for export/filter)

// ---------- storage ----------
function load() {
  return new Promise((res) => chrome.storage.local.get(['baseUrl', 'auth'], (d) => {
    store.baseUrl = d.baseUrl || '';
    store.auth = d.auth || null;
    res();
  }));
}
const save = () => new Promise((res) => chrome.storage.local.set({ baseUrl: store.baseUrl, auth: store.auth }, res));

const base = () => (store.baseUrl || '').replace(/\/+$/, '');

// ---------- Netlify Identity (gotrue) ----------
async function identityFetch(grantBody) {
  const res = await fetch(`${base()}/.netlify/identity/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: grantBody,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = j.error_description || j.msg || j.error || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json();
}

async function login(email, password) {
  const tok = await identityFetch(`grant_type=password&username=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`);
  store.auth = {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    expires_at: Date.now() + (tok.expires_in || 3600) * 1000,
    email,
  };
  await save();
}

async function authHeader() {
  if (!store.auth) return {};
  // Refresh if within 60s of expiry.
  if (Date.now() > (store.auth.expires_at || 0) - 60000 && store.auth.refresh_token) {
    try {
      const tok = await identityFetch(`grant_type=refresh_token&refresh_token=${encodeURIComponent(store.auth.refresh_token)}`);
      store.auth.access_token = tok.access_token;
      if (tok.refresh_token) store.auth.refresh_token = tok.refresh_token;
      store.auth.expires_at = Date.now() + (tok.expires_in || 3600) * 1000;
      await save();
    } catch { /* fall through with the (possibly stale) token */ }
  }
  return { Authorization: `Bearer ${store.auth.access_token}` };
}

function renderAuth() {
  const inAuth = !!store.auth;
  $('loggedIn').classList.toggle('hidden', !inAuth);
  $('loggedOut').classList.toggle('hidden', inAuth);
  if (inAuth) $('who').textContent = store.auth.email || 'user';
}

// ---------- input parsing ----------
// Paste: one URL per line; optional expected target after the FIRST comma or tab.
function parsePaste(text) {
  return String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
    const tab = line.indexOf('\t');
    const comma = line.indexOf(',');
    const idx = (tab >= 0 && comma >= 0) ? Math.min(tab, comma) : Math.max(tab, comma);
    if (idx >= 0) return { source: line.slice(0, idx).trim(), expected: line.slice(idx + 1).trim() };
    return { source: line, expected: '' };
  }).filter((r) => r.source);
}

function colName(c, i) { return String(c).trim() || `Column ${String.fromCharCode(65 + i)}`; }

function detectMapping(columns) {
  const norm = columns.map((c) => String(c).toLowerCase());
  const find = (res, fb) => {
    for (const re of res) { const i = norm.findIndex((c) => re.test(c)); if (i !== -1) return i; }
    return fb < columns.length ? fb : -1;
  };
  return {
    ruleName: find([/rule/, /\bname\b/, /\bid\b/], 0),
    source: find([/source/, /match.?url/, /\bfrom\b/, /\bold\b/, /^url$/], 1),
    expected: find([/expected/, /redirect.?url/, /target/, /destination/, /\bto\b/, /\bnew\b/], 2),
  };
}

async function parseFile(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
  if (!aoa.length) return { columns: [], rows: [] };
  const columns = aoa[0].map((c, i) => colName(c, i));
  const rows = aoa.slice(1).filter((r) => r.some((c) => String(c).trim() !== ''));
  return { columns, rows };
}

function fillSelect(sel, columns, selectedIdx, allowNone) {
  sel.innerHTML = '';
  if (allowNone) { const o = document.createElement('option'); o.value = '-1'; o.textContent = '(none)'; sel.appendChild(o); }
  columns.forEach((c, i) => {
    const o = document.createElement('option');
    o.value = String(i); o.textContent = c;
    if (i === selectedIdx) o.selected = true;
    sel.appendChild(o);
  });
}

function showMapping() {
  if (!sheet || !sheet.columns.length) return;
  const m = detectMapping(sheet.columns);
  fillSelect($('mapRule'), sheet.columns, m.ruleName, true);
  fillSelect($('mapSource'), sheet.columns, m.source, false);
  fillSelect($('mapExpected'), sheet.columns, m.expected, true);
  $('mapPane').classList.remove('hidden');
  updateRowCount();
}

function currentMapping() {
  return {
    ruleName: Number($('mapRule').value) >= 0 ? Number($('mapRule').value) : null,
    source: Number($('mapSource').value),
    expected: Number($('mapExpected').value) >= 0 ? Number($('mapExpected').value) : null,
  };
}

function auditableRows() {
  if (!sheet) return [];
  const m = currentMapping();
  return sheet.rows.filter((r) => {
    if (String(r[m.source] ?? '').trim() === '') return false;
    if (m.expected != null && String(r[m.expected] ?? '').trim() === '') return false;
    return true;
  });
}

function updateRowCount() {
  const n = auditableRows().length;
  $('rowCount').textContent = `${n} auditable row(s) (rows with a Source, and an Expected when mapped).`;
}

// ---------- run ----------
function activeTab() { return document.querySelector('.tab.active').dataset.tab; }

function buildPayload() {
  const now = new Date();
  const meta = { id: randId(), timestamp: now.toISOString(), localTime: now.toLocaleString() };
  if (activeTab() === 'upload') {
    if (!sheet || !sheet.rows.length) throw new Error('Upload a CSV/XLSX file first.');
    const mapping = currentMapping();
    const rows = auditableRows();
    if (!rows.length) throw new Error('No rows have a Source (and Expected, if mapped). Check the column mapping.');
    return { count: rows.length, payload: { mode: 'sheet', columns: sheet.columns, mapping, rows, ...meta } };
  }
  // paste
  const parsed = parsePaste($('pasteInput').value);
  if (!parsed.length) throw new Error('Paste at least one URL.');
  const hasExpected = parsed.some((p) => p.expected);
  if (hasExpected) {
    const columns = ['Source URL', 'Expected Target'];
    const rows = parsed.map((p) => [p.source, p.expected]);
    return { count: rows.length, payload: { mode: 'sheet', columns, mapping: { ruleName: null, source: 0, expected: 1 }, rows, ...meta } };
  }
  return { count: parsed.length, payload: { mode: 'paste', urls: parsed.map((p) => p.source), ...meta } };
}

function randId() {
  const a = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 4 }, () => a[Math.floor(Math.random() * a.length)]).join('');
}

let progTimer = null;
function startProgress(n) {
  $('progress').classList.remove('hidden');
  const batches = Math.ceil(n / 30);
  const estMs = 60000 + batches * 4000 + n * 1500;
  const start = Date.now();
  const tick = () => {
    const el = Date.now() - start;
    const pct = Math.min(95, (el / estMs) * 95);
    $('barFill').style.width = `${pct}%`;
    $('progressText').textContent = el >= estMs
      ? 'Still scanning on the runner… (a real browser audit can take a couple of minutes)'
      : `Scanning ${n} URL(s) in a real browser on GitHub Actions… ~${Math.ceil((estMs - el) / 1000)}s`;
  };
  tick();
  progTimer = setInterval(tick, 400);
}
function stopProgress(done) {
  if (progTimer) clearInterval(progTimer);
  progTimer = null;
  if (done) { $('barFill').style.width = '100%'; setTimeout(() => $('progress').classList.add('hidden'), 600); }
  else $('progress').classList.add('hidden');
}

async function run() {
  $('runMsg').textContent = ''; $('runMsg').className = 'msg';
  if (!base()) { $('runMsg').textContent = 'Set your Site URL in Settings first.'; $('runMsg').className = 'msg err'; $('settings').classList.remove('hidden'); return; }

  let built;
  try { built = buildPayload(); } catch (e) { $('runMsg').textContent = e.message; $('runMsg').className = 'msg err'; return; }

  if (built.count > ANON_LIMIT && !store.auth) {
    $('runMsg').textContent = `Log in (Settings) to audit more than ${ANON_LIMIT} URLs. This run has ${built.count}.`;
    $('runMsg').className = 'msg err'; $('settings').classList.remove('hidden'); return;
  }

  $('runBtn').disabled = true;
  startProgress(built.count);
  try {
    const hdr = await authHeader();
    const res = await fetch(`${base()}/api/audit-dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...hdr },
      body: JSON.stringify(built.payload),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status >= 400 && res.status !== 404) {
      throw new Error(data.error || `Request rejected (HTTP ${res.status}).`);
    }
    const reportPath = data.report;
    if (!reportPath) throw new Error('No report path returned by the server.');
    await pollReport(reportPath, hdr);
  } catch (e) {
    stopProgress(false);
    $('runMsg').textContent = e.message; $('runMsg').className = 'msg err';
  } finally {
    $('runBtn').disabled = false;
  }
}

async function pollReport(path, hdr) {
  const deadline = Date.now() + 14 * 60 * 1000;
  let polls = 0;
  while (Date.now() < deadline) {
    await sleep(Math.min(8000, 3000 + polls * 800));
    polls++;
    let res;
    try { res = await fetch(`${base()}/api/report?path=${encodeURIComponent(path)}`, { headers: hdr }); }
    catch { continue; }
    if (res.status === 404) continue; // not written yet
    if (!res.ok) continue;
    const data = await res.json().catch(() => null);
    if (!data) continue;
    if (data.error && !data.rows) throw new Error(data.error);
    if (data.rows && (data.status === 'complete' || !data.deepCheck)) {
      stopProgress(true);
      render(data);
      return;
    }
    if (data.rows) render(data); // partial — show what we have, keep polling
  }
  throw new Error('Timed out waiting for the scan. Open the site’s History later to find this report.');
}

// ---------- render ----------
function chip(cls, value, label) { return `<div class="chip ${cls}"><b>${value}</b><span>${label}</span></div>`; }

function render(report) {
  lastReport = report;
  $('results').classList.remove('hidden');
  const s = report.summary || { checked: 0, passed: 0, failed: 0, blocked: 0 };
  $('summary').innerHTML =
    chip('checked', s.checked || 0, 'checked') +
    chip('pass', s.passed || 0, 'passed') +
    chip('fail', s.failed || 0, 'failed') +
    chip('blocked', s.blocked || 0, 'blocked');
  renderTable();
}

function renderTable() {
  if (!lastReport) return;
  const f = $('filter').value;
  const rows = (lastReport.rows || []).filter((r) => {
    if (f === 'all') return true;
    if (f === 'fail') return r.verdict === 'FAIL';
    if (f === 'blocked') return r.verdict === 'BLOCKED';
    if (f === 'pass') return r.verdict === 'PASS';
    return true;
  });
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let html = `<table><thead><tr><th>Rule</th><th>Source → Actual</th><th>Verdict</th><th>Hops</th></tr></thead><tbody>`;
  rows.forEach((r, i) => {
    const hops = (r.hops || []).map((h) =>
      `<div class="hop"><span class="st">${h.status ?? '—'}</span><span class="url">${esc(h.url)}</span><span class="srv">${esc(h.server || '')}</span></div>`).join('');
    html += `<tr class="rowline">
      <td>${esc(r.ruleName || '')}</td>
      <td class="url">${esc(r.source)}<br><span class="muted">→ ${esc(r.finalUrl || '—')}${r.finalStatus ? ` [${r.finalStatus}]` : ''}</span>
        ${r.expected ? `<br><span class="muted">expected: ${esc(r.expected)}</span>` : ''}
        ${hops ? `<div class="expand" data-i="${i}">▸ ${r.hops.length} hop(s)</div><div class="hops hidden" id="hops-${i}">${hops}</div>` : ''}
      </td>
      <td><span class="verdict ${esc(r.verdict)}">${esc(r.verdict)}</span>${r.reason ? `<br><span class="reason">${esc(r.reason)}</span>` : ''}</td>
      <td>${r.hopCount ?? (r.hops ? r.hops.length : 0)}</td>
    </tr>`;
  });
  html += '</tbody></table>';
  if (!rows.length) html = '<p class="muted">No rows match this filter.</p>';
  $('tableWrap').innerHTML = html;
  $('tableWrap').querySelectorAll('.expand').forEach((el) => el.addEventListener('click', () => {
    $(`hops-${el.dataset.i}`).classList.toggle('hidden');
  }));
}

// ---------- export ----------
function download(name, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportJson() { if (lastReport) download(`${lastReport.filename || 'audit'}.json`, JSON.stringify(lastReport, null, 2), 'application/json'); }
function exportCsv() {
  if (!lastReport) return;
  const cell = (v) => { const s = String(v == null ? '' : v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ['Rule Name', 'Source URL', 'Expected Target', 'Actual Target', 'Verdict', 'Hop Count', 'Reason'];
  const lines = [head.join(',')];
  for (const r of lastReport.rows || []) {
    lines.push([r.ruleName, r.source, r.expected || '', r.finalUrl || '', r.verdict, r.hopCount, r.reason || ''].map(cell).join(','));
  }
  download(`${lastReport.filename || 'audit'}.csv`, lines.join('\r\n'), 'text/csv');
}

// ---------- wire up ----------
async function init() {
  await load();
  $('baseUrl').value = store.baseUrl;
  renderAuth();

  $('settingsToggle').addEventListener('click', () => $('settings').classList.toggle('hidden'));
  $('saveSettings').addEventListener('click', async () => {
    store.baseUrl = $('baseUrl').value.trim();
    await save();
    $('settingsMsg').textContent = 'Saved.'; $('settingsMsg').className = 'msg ok';
    setTimeout(() => { $('settingsMsg').textContent = ''; }, 2000);
  });

  $('loginBtn').addEventListener('click', async () => {
    $('authMsg').textContent = ''; $('authMsg').className = 'msg';
    if (!base()) { $('authMsg').textContent = 'Set and save the Site URL first.'; $('authMsg').className = 'msg err'; return; }
    try {
      await login($('email').value.trim(), $('password').value);
      $('password').value = '';
      renderAuth();
      $('authMsg').textContent = 'Signed in.'; $('authMsg').className = 'msg ok';
    } catch (e) { $('authMsg').textContent = `Login failed: ${e.message}`; $('authMsg').className = 'msg err'; }
  });
  $('logoutBtn').addEventListener('click', async () => { store.auth = null; await save(); renderAuth(); });

  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    $('pastePane').classList.toggle('hidden', t.dataset.tab !== 'paste');
    $('uploadPane').classList.toggle('hidden', t.dataset.tab !== 'upload');
  }));

  $('fileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try { sheet = await parseFile(file); showMapping(); }
    catch (err) { $('runMsg').textContent = `Could not parse file: ${err.message}`; $('runMsg').className = 'msg err'; }
  });
  ['mapRule', 'mapSource', 'mapExpected'].forEach((id) => $(id).addEventListener('change', updateRowCount));

  $('runBtn').addEventListener('click', run);
  $('filter').addEventListener('change', renderTable);
  $('exportCsv').addEventListener('click', exportCsv);
  $('exportJson').addEventListener('click', exportJson);
}

document.addEventListener('DOMContentLoaded', init);
