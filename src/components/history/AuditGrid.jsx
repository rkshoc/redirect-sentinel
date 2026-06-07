import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown, FileText, Search } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { maskEmail, formatLocal } from '../../lib/format.js';

const fmtDate = (a) => (a.createdUtc ? formatLocal(a.createdUtc, { tz: false }) : (a.day || '—'));

const COLS = [
  { key: 'date', label: 'Date (local)', get: (a) => a.createdUtc || a.day || '' },
  { key: 'name', label: 'Audit', get: (a) => a.name || '' },
  { key: 'user', label: 'User', get: (a) => a.user || '' },
  { key: 'checked', label: 'Checked', num: true, get: (a) => a.summary?.checked ?? -1 },
  { key: 'passed', label: 'Pass', num: true, get: (a) => a.summary?.passed ?? -1 },
  { key: 'failed', label: 'Fail', num: true, get: (a) => a.summary?.failed ?? -1 },
  { key: 'status', label: 'Status', get: (a) => a.status || '' },
];

export function AuditGrid({ audits, onOpenAudit }) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState('date');
  const [sortDir, setSortDir] = useState(-1); // newest first

  const rows = useMemo(() => {
    const q = query.toLowerCase();
    const filtered = audits.filter((a) => !q || `${a.name} ${a.user || ''} ${a.day || ''}`.toLowerCase().includes(q));
    const col = COLS.find((c) => c.key === sortKey);
    return [...filtered].sort((a, b) => {
      const va = col.get(a), vb = col.get(b);
      if (col.num) return (va - vb) * sortDir;
      return String(va).localeCompare(String(vb)) * sortDir;
    });
  }, [audits, query, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => -d);
    else { setSortKey(key); setSortDir(key === 'date' ? -1 : 1); }
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-faint">{rows.length} audit{rows.length === 1 ? '' : 's'}</span>
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="search rule set / user…"
            className="w-52 rounded-lg border border-line bg-panel/60 py-1.5 pl-8 pr-3 font-mono text-[12px] text-ink outline-none focus:border-aem"
          />
        </div>
      </div>

      <div className="max-h-[68vh] overflow-auto rounded-2xl border border-line bg-panel/70 backdrop-blur-sm">
        <table className="w-full border-collapse font-mono text-[12px]">
          <thead>
            <tr>
              {COLS.map((c) => {
                const active = sortKey === c.key;
                const Icon = active ? (sortDir > 0 ? ArrowUp : ArrowDown) : ChevronsUpDown;
                return (
                  <th
                    key={c.key}
                    onClick={() => toggleSort(c.key)}
                    className={cn(
                      'sticky top-0 z-10 cursor-pointer select-none whitespace-nowrap border-b border-line2 bg-panel2 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider',
                      c.num ? 'text-right' : 'text-left',
                      active ? 'text-ink' : 'text-muted hover:text-ink',
                    )}
                  >
                    <span className="inline-flex items-center gap-1">{c.label}<Icon size={11} className={active ? 'text-ak' : 'text-faint'} /></span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((a) => (
              <tr key={a.file} onClick={() => onOpenAudit(a.file)} className="cursor-pointer border-b border-line transition-colors hover:bg-panel2/70">
                <td className="px-3 py-2 text-muted">{fmtDate(a)}</td>
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-1.5"><FileText size={12} className="text-aem" /> {a.name}</span>
                </td>
                <td className="px-3 py-2 text-faint">{maskEmail(a.user) || '—'}</td>
                <td className="px-3 py-2 text-right text-muted">{a.summary?.checked ?? '—'}</td>
                <td className="px-3 py-2 text-right text-pass">{a.summary?.passed ?? '—'}</td>
                <td className="px-3 py-2 text-right text-fail">{a.summary?.failed ?? '—'}</td>
                <td className="px-3 py-2">
                  <span className={cn('rounded px-1.5 py-0.5 text-[10px]', a.status === 'partial' ? 'bg-blocked/15 text-blocked' : 'bg-pass/15 text-pass')}>
                    {a.status || 'complete'}
                  </span>
                </td>
              </tr>
            )) : (
              <tr><td colSpan={7} className="py-9 text-center text-faint">No audits match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
