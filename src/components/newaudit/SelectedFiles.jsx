import { FileSpreadsheet, X } from 'lucide-react';
import { countFileRows } from '../../lib/parse.js';

// Shows which files are selected (the user asked to see this), each with its
// auditable-row count and a remove button.
export function SelectedFiles({ files, refColumns, refMapping, onRemove }) {
  if (!files.length) return null;
  return (
    <div className="mt-3 space-y-1.5">
      {files.map((f) => {
        const n = refMapping ? countFileRows(f, refColumns, refMapping) : f.sheet.rows.length;
        return (
          <div key={f.name} className="flex items-center gap-2.5 rounded-lg border border-line bg-bg/60 px-3 py-2">
            <FileSpreadsheet size={14} className="shrink-0 text-aem" />
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink" title={f.name}>{f.name}</span>
            <span className="shrink-0 font-mono text-[11px] text-faint">{n} row{n === 1 ? '' : 's'}</span>
            <button
              onClick={() => onRemove(f.name)}
              className="shrink-0 rounded p-0.5 text-faint transition hover:text-fail"
              aria-label={`Remove ${f.name}`}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
