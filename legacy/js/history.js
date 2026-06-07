// History view — lazily browse the UTC date-foldered archive (CLAUDE.md §8).
// Clicking an audit loads its JSON via /api/report and re-renders the Report
// tab. Any logged-in user can read all reports.

import { authHeaders } from './app.js';

async function api(path) {
  const res = await fetch(`/api/reports${path ? `?path=${encodeURIComponent(path)}` : ''}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

function monthName(mm) {
  return ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(mm)] || mm;
}

function audCounts(a) {
  const s = a.summary || {};
  return `<span class="fmeta">
    <span class="hchk">${s.checked ?? 0} checked</span>
    <span class="hpass">${s.passed ?? 0} ✓</span>
    <span class="hfailc">${s.failed ?? 0} ✕</span>
    <span class="huser">${a.user || ''}</span></span>`;
}

// Render a collapsible folder node that loads its children on first expand.
function folderNode(name, path, level, onOpenAudit) {
  const wrap = document.createElement('div');
  wrap.className = level === 0 ? 'hyear' : (level === 1 ? 'hmonth' : 'hday');
  const node = document.createElement('div');
  node.className = 'hnode';
  const label = level === 1 ? `📁 ${name} · ${monthName(name)}` : `📁 ${name}`;
  node.innerHTML = `<span class="tw">▸</span>${label}`;
  const children = document.createElement('div');
  children.style.display = 'none';
  let loaded = false;
  node.addEventListener('click', async () => {
    const open = children.style.display === 'none';
    children.style.display = open ? 'block' : 'none';
    node.querySelector('.tw').textContent = open ? '▾' : '▸';
    if (open && !loaded) {
      loaded = true;
      children.innerHTML = `<div class="hint" style="margin-left:24px">loading…</div>`;
      try {
        const data = await api(path);
        children.innerHTML = '';
        if (data.kind === 'folders') {
          data.folders.forEach((f) => children.appendChild(folderNode(f.name, f.path, level + 1, onOpenAudit)));
          if (!data.folders.length) children.innerHTML = `<div class="hint" style="margin-left:24px">empty</div>`;
        } else {
          (data.audits || []).forEach((a) => {
            const file = document.createElement('div');
            file.className = 'hfile';
            file.innerHTML = `<span class="fi">📄</span> ${a.name || a.file.split('/').pop().replace(/\.json$/, '')} ${a.summary ? audCounts(a) : ''}`;
            file.addEventListener('click', (e) => { e.stopPropagation(); onOpenAudit(a.file); });
            children.appendChild(file);
          });
          if (!data.audits.length) children.innerHTML = `<div class="hint" style="margin-left:24px">no audits</div>`;
        }
      } catch (e) {
        children.innerHTML = `<div class="hint" style="margin-left:24px;color:var(--fail)">${e.message}</div>`;
      }
    }
  });
  wrap.appendChild(node);
  wrap.appendChild(children);
  return wrap;
}

export async function loadHistory(mount, loggedIn, onOpenAudit) {
  if (!loggedIn) { mount.innerHTML = `<div class="empty">Log in to browse the audit archive.</div>`; return; }
  mount.innerHTML = `<div class="hint">loading…</div>`;
  try {
    const data = await api('');
    mount.innerHTML = '';
    if (!data.folders || !data.folders.length) { mount.innerHTML = `<div class="empty">No audits archived yet.</div>`; return; }
    data.folders.forEach((f) => mount.appendChild(folderNode(f.name, f.path, 0, onOpenAudit)));
  } catch (e) {
    mount.innerHTML = `<div class="empty" style="color:var(--fail)">${e.message}</div>`;
  }
}
