import { cn } from '../../lib/cn.js';

const ROLES = [
  ['ruleName', 'Rule Name', false],
  ['source', 'Source', true],
  ['expected', 'Expected', true],
];

// Column-mapping confirmation: detected columns + remap dropdowns + live preview
// and an auditable-row count (CLAUDE.md §5). Positions are never hardcoded.
// `columns`/`sampleRow` come from the reference (first) file; `usable`/`total`
// are the COMBINED counts across all selected files; the mapping is matched by
// header name in the other files.
export function ColumnMap({ columns, sampleRow, rowCount, mapping, onChange, usable, total, fileCount }) {
  const needsExp = mapping.expected != null;
  const set = (key, value) => onChange({ ...mapping, [key]: value === -1 ? null : value });

  return (
    <div className="mt-4 rounded-xl border border-line bg-panel2/60 p-4">
      <h4 className="mb-3 font-mono text-[11px] uppercase tracking-wider text-muted">
        Detected columns — confirm mapping ({rowCount} rows{fileCount > 1 ? ` · ${fileCount} files, matched by header name` : ''})
      </h4>
      <div className="grid gap-2.5 sm:grid-cols-3">
        {ROLES.map(([key, label, required]) => (
          <div key={key} className={cn('rounded-lg border bg-bg p-2.5', required ? 'border-aem/50' : 'border-line')}>
            <div className={cn('font-mono text-[10px]', required ? 'text-aem' : 'text-faint')}>
              {label}{required ? ' ★' : ''}
            </div>
            <select
              value={mapping[key] ?? -1}
              onChange={(e) => set(key, Number(e.target.value))}
              className="mt-1.5 w-full rounded-md border border-line bg-panel2 px-2 py-1.5 font-mono text-[11.5px] text-ink outline-none focus:border-aem"
            >
              {columns.map((c, i) => (
                <option key={i} value={i}>{c}</option>
              ))}
              <option value={-1}>— none —</option>
            </select>
            <div className="mt-1.5 truncate font-mono text-[11.5px] text-muted">
              {mapping[key] == null ? '—' : String(sampleRow[mapping[key]] ?? '').slice(0, 40) || '—'}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 border-t border-line pt-3 font-mono text-[11.5px] text-aem">
        <b>{usable}</b> of {total} rows have a Source{needsExp ? ' + Expected' : ''} URL and will be audited
        {usable < total && (
          <span className="text-faint"> · {total - usable} blank/incomplete rows skipped</span>
        )}
      </div>
    </div>
  );
}
