import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown, Loader2 } from 'lucide-react';
import { COLS, VMETA, matchesFilter, sortRows, totalMs } from '../../lib/verdict.js';
import { cn } from '../../lib/cn.js';
import { Filters } from './Filters.jsx';
import { ExportButtons } from './ExportButtons.jsx';
import { ReasonBlock } from './ReasonBlock.jsx';
import { HopChain } from './HopChain.jsx';

const PAGE = 100;

const PILL = {
  pass: 'border-pass/30 bg-pass/15 text-pass',
  fail: 'border-fail/30 bg-fail/15 text-fail',
  blocked: 'border-blocked/30 bg-blocked/15 text-blocked',
  info: 'border-info/30 bg-info/15 text-info',
};
const ACCENT = { PASS: 'border-l-pass', FAIL: 'border-l-fail', BLOCKED: 'border-l-blocked', INFO: 'border-l-info' };

function Url({ value, className }) {
  if (!value) return <span className="text-faint">—</span>;
  return <span title={value} className={cn('block max-w-[230px] truncate', className)}>{value}</span>;
}

function ReportRow({ row, expanded, onToggle }) {
  // Deep-check still pending — live spinner row, no expandable detail yet.
  if (row.deepPending && row.verdict === 'BLOCKED') {
    return (
      <tr className="border-b border-line">
        <td className={cn('border-l-2 px-3 py-2', ACCENT.BLOCKED)}><Url value={row.ruleName || row.source} className="font-semibold" /></td>
        <td className="px-3 py-2"><Url value={row.source} /></td>
        <td className="px-3 py-2 text-faint">—</td>
        <td className="px-3 py-2 text-faint">re-running via Playwright…</td>
        <td className="px-3 py-2">
          <span className={cn('inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[10px] font-semibold', PILL.blocked)}>
            <Loader2 size={11} className="animate-spin" /> Deep-check
          </span>
        </td>
        <td className="px-3 py-2 text-right text-muted">{row.hopCount || 0}</td>
        <td className="px-3 py-2 text-right text-faint">—</td>
      </tr>
    );
  }

  const m = VMETA[row.verdict] || { label: row.verdict, tone: 'info', glyph: '•' };
  return (
    <>
      <tr onClick={onToggle} className={cn('cursor-pointer border-b border-line transition-colors hover:bg-panel2/70', expanded && 'bg-panel2/70')}>
        <td className={cn('border-l-2 px-3 py-2', ACCENT[row.verdict] || 'border-l-line2')}>
          <Url value={row.ruleName || '(no rule name)'} className="font-semibold" />
        </td>
        <td className="px-3 py-2"><Url value={row.source} /></td>
        <td className="px-3 py-2"><Url value={row.expected} /></td>
        <td className="px-3 py-2"><Url value={row.finalUrl} /></td>
        <td className="px-3 py-2">
          <span className={cn('inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] font-semibold', PILL[m.tone])}>
            {m.glyph} {m.label}
          </span>
          {row.verdict === 'FAIL' && row.reason && <div className="mt-1 font-mono text-[9.5px] text-faint">{row.reason}</div>}
          {row.deepChecked && <div className="mt-1 font-mono text-[9.5px] text-faint">deep-checked</div>}
        </td>
        <td className="px-3 py-2 text-right text-muted">{row.hopCount || 0}</td>
        <td className="px-3 py-2 text-right text-muted">{totalMs(row)}</td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} className="border-b border-line2 bg-bg p-0">
            <div className="animate-fade-up p-4">
              <ReasonBlock row={row} />
              <HopChain hops={row.hops} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function DataGrid({ report }) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState(1);
  const [shown, setShown] = useState(PAGE);
  const [expanded, setExpanded] = useState(() => new Set());

  // Reset view state only when a DIFFERENT audit loads — preserve it across
  // partial→complete refreshes of the same audit (keyed by filename/id).
  const identity = report.filename || report.id;
  useEffect(() => {
    setFilter('all'); setQuery(''); setSortKey(null); setSortDir(1); setShown(PAGE); setExpanded(new Set());
  }, [identity]);

  const indexed = useMemo(() => report.rows.map((r, _idx) => ({ ...r, _idx })), [report]);
  const counts = useMemo(() => ({
    all: report.rows.length,
    fail: report.rows.filter((r) => r.verdict === 'FAIL').length,
    blocked: report.rows.filter((r) => r.verdict === 'BLOCKED').length,
  }), [report]);

  const visible = useMemo(
    () => sortRows(indexed.filter((r) => matchesFilter(r, { filter, query })), { sortKey, sortDir }),
    [indexed, filter, query, sortKey, sortDir],
  );
  const page = visible.slice(0, shown);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => -d);
    else { setSortKey(key); setSortDir(1); }
  };
  const toggleRow = (idx) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(idx) ? next.delete(idx) : next.add(idx);
    return next;
  });

  return (
    <div className="animate-fade-up">
      <Filters filter={filter} query={query} counts={counts} onFilter={(f) => { setFilter(f); setShown(PAGE); }} onQuery={(q) => { setQuery(q.toLowerCase()); setShown(PAGE); }} />
      <ExportButtons report={report} shownCount={page.length} totalCount={visible.length} onExpandAll={() => setExpanded(new Set(page.map((r) => r._idx)))} />

      <div className="max-h-[72vh] overflow-auto rounded-2xl border border-line bg-panel/70 backdrop-blur-sm">
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
                    <span className="inline-flex items-center gap-1">
                      {c.label}
                      <Icon size={11} className={active ? 'text-ak' : 'text-faint'} />
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {page.length ? (
              page.map((row) => (
                <ReportRow key={row._idx} row={row} expanded={expanded.has(row._idx)} onToggle={() => toggleRow(row._idx)} />
              ))
            ) : (
              <tr><td colSpan={7} className="py-9 text-center text-faint">No rows match this filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {visible.length > shown && (
        <div className="mt-3 text-center">
          <button
            onClick={() => setShown((s) => s + PAGE)}
            className="rounded-lg border border-line bg-panel/60 px-4 py-2 font-mono text-[11.5px] text-muted transition hover:border-aem hover:text-ink"
          >
            Show {Math.min(PAGE, visible.length - shown)} more · {visible.length - shown} hidden
          </button>
        </div>
      )}
    </div>
  );
}
