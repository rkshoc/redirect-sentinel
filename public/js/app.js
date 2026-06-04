// Redirect Sentinel — frontend controller (CLAUDE.md §9 stage 1).
// Identity, tab routing, upload + column mapping, run + poll, report + history.

import { parseFile, detectMapping, parsePaste } from './parse.js';
import { renderReport } from './render.js';
import { loadHistory } from './history.js';

/* global netlifyIdentity */

// ---- Tier limits (mirrors server lib/auth.mjs for UX; server is authoritative) ----
const ROLE_LIMITS = { owner: Infinity, admin: 100, advanced: 55, basic: 30 };
const ANON_LIMIT = 10;

const state = {
  user: null,        // netlifyIdentity user or null
  role: null,
  limit: ANON_LIMIT,
  sheet: null,       // { columns, rows }
  mapping: null,     // { ruleName, source, expected }
};

const $ = (id) => document.getElementById(id);

// ---------- Identity ----------
export async function authHeaders() {
  const u = netlifyIdentity.currentUser();
  if (!u) return {};
  try {
    const jwt = await u.jwt(); // refreshes if needed
    return { Authorization: `Bearer ${jwt}` };
  } catch {
    return {};
  }
}

function resolveRole(user) {
  if (!user) return { role: null, limit: ANON_LIMIT };
  const roles = (user.app_metadata?.roles || []).map((r) => String(r).toLowerCase());
  const order = ['owner', 'admin', 'advanced', 'basic'];
  const role = order.find((r) => roles.includes(r)) || null;
  return { role, limit: role ? ROLE_LIMITS[role] : ROLE_LIMITS.basic };
}

function refreshWho() {
  const { role, limit } = resolveRole(state.user);
  state.role = role; state.limit = limit;
  const who = $('who');
  if (state.user) {
    const lim = limit === Infinity ? 'unlimited' : `≤${limit} URLs`;
    who.innerHTML = `<span class="role">${role || 'member'}</span>
      <span class="lim">${lim} · ${state.user.email}</span>
      <button id="authBtn">Log out</button>`;
    $('authBtn').onclick = () => netlifyIdentity.logout();
  } else {
    who.innerHTML = `<span class="lim">not logged in · ≤${ANON_LIMIT} URLs</span><button id="authBtn">Log in</button>`;
    $('authBtn').onclick = () => netlifyIdentity.open();
  }
  updateRunHint();
}

// ---------- Tabs ----------
function tab(i) {
  document.querySelectorAll('.tabs button').forEach((b, n) => b.classList.toggle('on', n === i));
  document.querySelectorAll('.view').forEach((v, n) => v.classList.toggle('on', n === i));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (i === 2) loadHistory($('htree'), !!state.user, openAudit);
}

// ---------- Upload + column mapping ----------
async function onFile(file) {
  try {
    state.sheet = await parseFile(file);
    state.mapping = detectMapping(state.sheet.columns);
    renderMapping();
  } catch (e) {
    showErr(`Couldn't parse "${file.name}": ${e.message}`);
  }
}

function renderMapping() {
  const { columns, rows } = state.sheet;
  $('mapBox').style.display = 'block';
  $('mapTitle').textContent = `Detected columns — confirm mapping (${rows.length} rows)`;
  const roles = [['ruleName', 'Rule Name'], ['source', 'Source ★'], ['expected', 'Expected ★']];
  const opts = (sel) => columns.map((c, i) => `<option value="${i}" ${sel === i ? 'selected' : ''}>${c}</option>`).join('') + `<option value="-1" ${sel == null ? 'selected' : ''}>— none —</option>`;
  $('mapRow').innerHTML = roles.map(([key, label]) => `
    <div class="mapcol ${key !== 'ruleName' ? 'key' : ''}">
      <div class="cn">${label}</div>
      <select data-role="${key}">${opts(state.mapping[key])}</select>
      <div class="cv" id="prev_${key}"></div>
    </div>`).join('');
  $('mapRow').querySelectorAll('select').forEach((s) => {
    s.addEventListener('change', () => {
      const v = Number(s.value);
      state.mapping[s.dataset.role] = v === -1 ? null : v;
      updatePreview();
    });
  });
  updatePreview();
  updateRunHint();
}

function updatePreview() {
  const first = state.sheet.rows[0] || [];
  for (const key of ['ruleName', 'source', 'expected']) {
    const i = state.mapping[key];
    $(`prev_${key}`).textContent = i == null ? '—' : String(first[i] ?? '').slice(0, 40);
  }
}

// ---------- Run hint / limit messaging ----------
function currentCount() {
  if (state.sheet) return state.sheet.rows.length;
  return parsePaste($('pasteBox').value).length;
}

function updateRunHint() {
  const n = currentCount();
  const hint = $('runHint');
  if (!n) { hint.textContent = 'Upload a sheet or paste URLs to begin.'; return; }
  const over = n > state.limit;
  const batches = Math.ceil(n / 30);
  hint.innerHTML = over
    ? `<span style="color:var(--fail)">${n} URLs exceeds your ${state.limit === Infinity ? '∞' : state.limit} limit${!state.user ? ' — log in for more' : ''}.</span>`
    : `${n} rules · ${batches > 1 ? `auto-chunked (~30/batch) to stay under the WAF limit · ` : ''}${state.user ? '' : 'anonymous '}`;
}

// ---------- Run audit ----------
const p2 = (n) => String(n).padStart(2, '0');
function predictPath(date, userLabel, id) {
  const y = date.getUTCFullYear(), m = p2(date.getUTCMonth() + 1), d = p2(date.getUTCDate());
  const stamp = `${y}-${m}-${d}T${p2(date.getUTCHours())}${p2(date.getUTCMinutes())}Z`;
  const safe = String(userLabel || 'anon').replace(/[^a-z0-9_.-]/gi, '-').toLowerCase();
  return `${y}/${m}/${d}/audit_${stamp}_${safe}_${id}.json`;
}
function shortId() {
  const a = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 4 }, () => a[Math.floor(Math.random() * a.length)]).join('');
}

function buildPayload() {
  const baseUrl = $('baseUrl').value.trim();
  const id = shortId();
  const now = new Date();
  const timestamp = now.toISOString();
  const userLabel = state.user ? state.user.email : 'anon';
  const path = predictPath(now, userLabel, id);
  let payload;
  if (state.sheet && state.sheet.rows.length) {
    const m = state.mapping;
    if (m.source == null) { showErr('Map a Source URL column before running.'); return null; }
    payload = { mode: 'sheet', columns: state.sheet.columns, mapping: m, rows: state.sheet.rows, baseUrl, id, timestamp };
  } else {
    const urls = parsePaste($('pasteBox').value);
    if (!urls.length) { showErr('Paste at least one URL, or upload a sheet.'); return null; }
    payload = { mode: 'paste', urls, baseUrl, id, timestamp };
  }
  return { payload, path };
}

async function runAudit() {
  hideErr();
  const built = buildPayload();
  if (!built) return;
  const { payload, path } = built;
  const n = payload.mode === 'paste' ? payload.urls.length : payload.rows.length;

  if (n > state.limit) { showErr(`${n} URLs exceeds your limit of ${state.limit}.`); return; }
  if (!state.user && n > ANON_LIMIT) { showErr(`Log in to audit more than ${ANON_LIMIT} URLs.`); return; }

  $('runBtn').disabled = true;
  startProgress(n);

  let res;
  try {
    res = await fetch('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    stopProgress(); $('runBtn').disabled = false; showErr(`Network error: ${e.message}`); return;
  }

  // Background functions return 202 (accepted). A 4xx is a hard rejection.
  if (res.status >= 400 && res.status !== 404) {
    stopProgress(); $('runBtn').disabled = false;
    const msg = (await res.json().catch(() => ({}))).error || `Request rejected (HTTP ${res.status}).`;
    showErr(msg); return;
  }

  pollReport(path);
}

// ---------- Progress (time-estimate; the background fn doesn't stream) ----------
let progTimer = null;
function startProgress(n) {
  const batches = Math.ceil(n / 30);
  const estMs = batches * 4000 + n * 600; // cooldowns + rough per-URL time
  const start = Date.now();
  $('prog').classList.add('show');
  $('pmsg').textContent = `Auditing ${n} URL${n === 1 ? '' : 's'} across ${batches} batch${batches === 1 ? '' : 'es'}…`;
  $('pcount').textContent = '';
  progTimer = setInterval(() => {
    const pct = Math.min(90, ((Date.now() - start) / estMs) * 90);
    $('pfill').style.width = `${pct}%`;
  }, 300);
}
function stopProgress() { clearInterval(progTimer); $('prog').classList.remove('show'); $('pfill').style.width = '0%'; }
function finishProgress() { clearInterval(progTimer); $('pfill').style.width = '100%'; setTimeout(() => $('prog').classList.remove('show'), 600); }

// ---------- Poll for the report ----------
async function pollReport(path) {
  const deadline = Date.now() + 14 * 60 * 1000; // background fn max ~15 min
  let interval = 3000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    let data;
    try {
      const res = await fetch(`/api/report?path=${encodeURIComponent(path)}`, { headers: await authHeaders() });
      if (res.status === 404) { $('pmsg').textContent = 'Auditing… (waiting for results)'; continue; }
      data = await res.json();
      if (res.status >= 500) { stopProgress(); $('runBtn').disabled = false; showErr(data.error || `Server error (HTTP ${res.status}).`); return; }
    } catch { continue; }

    if (data && data.error && !data.rows) { stopProgress(); $('runBtn').disabled = false; showErr(data.error); return; }
    if (data && data.rows) {
      finishProgress();
      $('runBtn').disabled = false;
      openReport(data);
      if (data.status === 'partial') { interval = 12000; continue; } // keep polling for deep-checks
      return;
    }
  }
  $('runBtn').disabled = false; stopProgress();
  showErr('Audit timed out waiting for results. Check the History tab shortly.');
}

// ---------- Report / history glue ----------
function openReport(report) {
  $('reportBanner').classList.remove('show');
  renderReport(report, $('reportBody'));
  tab(1);
}
async function openAudit(file) {
  $('reportBody').innerHTML = `<div class="empty">Loading ${file}…</div>`;
  tab(1);
  try {
    const res = await fetch(`/api/report?path=${encodeURIComponent(file)}`, { headers: await authHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    renderReport(data, $('reportBody'));
  } catch (e) {
    $('reportBody').innerHTML = `<div class="empty" style="color:var(--fail)">${e.message}</div>`;
  }
}

// ---------- Error banner ----------
function showErr(msg) { const b = $('auditErr'); b.textContent = msg; b.classList.add('show'); }
function hideErr() { $('auditErr').classList.remove('show'); }

// ---------- Boot ----------
function boot() {
  // Tabs
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => tab(Number(b.dataset.tab))));

  // Upload
  const drop = $('drop'), fileInput = $('fileInput');
  drop.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) onFile(fileInput.files[0]); });
  ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]); });

  $('pasteBox').addEventListener('input', () => { if (!state.sheet) updateRunHint(); });
  $('runBtn').addEventListener('click', runAudit);

  // Identity
  netlifyIdentity.on('init', (user) => { state.user = user; refreshWho(); });
  netlifyIdentity.on('login', (user) => { state.user = user; refreshWho(); netlifyIdentity.close(); });
  netlifyIdentity.on('logout', () => { state.user = null; refreshWho(); });
  netlifyIdentity.init();
  refreshWho();
}

document.addEventListener('DOMContentLoaded', boot);
