import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useAuditRun } from '../hooks/useAuditRun.js';
import { MAX_AUDIT_URLS } from '../lib/api.js';
import { parseFile, detectMapping, parsePaste, auditableRows, combineSheets } from '../lib/parse.js';
import { Banner } from '../components/Banner.jsx';
import { FileDrop } from '../components/newaudit/FileDrop.jsx';
import { SelectedFiles } from '../components/newaudit/SelectedFiles.jsx';
import { ColumnMap } from '../components/newaudit/ColumnMap.jsx';
import { ProgressBar } from '../components/newaudit/ProgressBar.jsx';
import { ShimmerButton } from '../components/ui/ShimmerButton.jsx';

function runHint({ count, limit, user }) {
  if (!count) return { over: false, text: 'Upload a sheet or paste URLs to begin.' };
  if (count > MAX_AUDIT_URLS) {
    return { over: true, text: `${count} URLs — runs are capped at ${MAX_AUDIT_URLS} (payload + time limits). Split into separate files.` };
  }
  if (count > limit) {
    return { over: true, text: `${count} URLs exceeds your ${limit === Infinity ? '∞' : limit} limit${!user ? ' — log in for more' : ''}.` };
  }
  const batches = Math.ceil(count / 30);
  return { over: false, text: `${count} rules · ${batches > 1 ? 'auto-chunked (~30/batch) to stay under the WAF limit · ' : ''}${user ? '' : 'anonymous '}` };
}

const LEGEND = [
  ['bg-ak', 'Akamai edge'],
  ['bg-aem', 'AEM dispatcher'],
  ['bg-origin', 'AEM publish / origin'],
];

export function NewAuditView({ onReport }) {
  const { user, limit } = useAuth();
  const [files, setFiles] = useState([]);            // [{ name, sheet }]
  const [mapping, setMapping] = useState(null);      // shared mapping → indices into files[0].columns
  const [pasteText, setPasteText] = useState('');
  const [parseErr, setParseErr] = useState('');
  const { run, running, progress, error, clearError } = useAuditRun({ onReport });

  // Re-detect the shared mapping only when the REFERENCE (first) file changes,
  // so adding/removing other files keeps the user's manual remap.
  const refName = files[0]?.name;
  const lastRef = useRef(null);
  useEffect(() => {
    if (!files.length) { setMapping(null); lastRef.current = null; return; }
    if (refName !== lastRef.current) { setMapping(detectMapping(files[0].sheet.columns)); lastRef.current = refName; }
  }, [refName, files]);

  const onFiles = async (picked) => {
    setParseErr('');
    const parsed = [];
    for (const file of picked) {
      try { parsed.push({ name: file.name, sheet: await parseFile(file) }); }
      catch (e) { setParseErr(`Couldn't parse "${file.name}": ${e.message}`); }
    }
    if (!parsed.length) return;
    setFiles((prev) => {
      const map = new Map(prev.map((f) => [f.name, f]));
      for (const p of parsed) map.set(p.name, p); // dedupe / replace by name
      return Array.from(map.values());
    });
  };
  const onRemove = (name) => setFiles((prev) => prev.filter((f) => f.name !== name));

  const refSheet = files[0]?.sheet;
  const combined = useMemo(() => (files.length && mapping ? combineSheets(files, mapping) : null), [files, mapping]);
  const totalRows = useMemo(() => files.reduce((a, f) => a + f.sheet.rows.length, 0), [files]);
  const usable = combined ? combined.sheet.rows.length : 0;
  const sampleRow = (refSheet && mapping && auditableRows(refSheet, mapping)[0]) || refSheet?.rows[0] || [];

  const count = files.length ? usable : parsePaste(pasteText).length;
  const hint = runHint({ count, limit, user });
  const shownErr = parseErr || error;

  return (
    <div className="animate-fade-up">
      <Banner show={!!shownErr} tone="err" onClose={() => { setParseErr(''); clearError(); }}>{shownErr}</Banner>

      <div className="card p-6">
        <label className="mb-2.5 block font-mono text-[11px] uppercase tracking-wider text-muted">
          Upload rules sheet(s) · .xlsx or .csv
        </label>
        <FileDrop onFiles={onFiles} />
        <SelectedFiles files={files} refColumns={refSheet?.columns || []} refMapping={mapping} onRemove={onRemove} />
        {refSheet && mapping && (
          <ColumnMap
            columns={refSheet.columns}
            sampleRow={sampleRow}
            rowCount={refSheet.rows.length}
            mapping={mapping}
            onChange={setMapping}
            usable={usable}
            total={totalRows}
            fileCount={files.length}
          />
        )}

        <div className="my-4 text-center font-mono text-[11px] text-faint">
          — or paste URLs directly (no expected-target check) —
        </div>
        <textarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          disabled={files.length > 0}
          placeholder={'https://www.example.com/old-products\nhttps://www.example.com/legacy/promo'}
          className="min-h-[84px] w-full resize-y rounded-xl border border-line bg-bg p-3 font-mono text-[13px] leading-relaxed text-ink outline-none focus:border-aem disabled:opacity-50"
        />

        <div className="mt-5 flex flex-wrap items-center gap-4">
          <ShimmerButton
            onClick={() => run({ sheet: combined?.sheet, mapping: combined?.mapping, pasteText, user, limit })}
            disabled={running || hint.over || !count}
          >
            Run audit <ArrowRight size={15} />
          </ShimmerButton>
          <span className={`font-mono text-[11.5px] ${hint.over ? 'text-fail' : 'text-faint'}`}>{hint.text}</span>
        </div>

        <ProgressBar progress={progress} />
      </div>

      <div className="mt-3 flex flex-wrap gap-4 font-mono text-[10.5px] text-faint">
        {LEGEND.map(([c, label]) => (
          <span key={label} className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-sm ${c}`} /> {label}
          </span>
        ))}
      </div>
    </div>
  );
}
