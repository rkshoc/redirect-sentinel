import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useAuditRun } from '../hooks/useAuditRun.js';
import { parseFile, detectMapping, parsePaste, auditableRows } from '../lib/parse.js';
import { Banner } from '../components/Banner.jsx';
import { FileDrop } from '../components/newaudit/FileDrop.jsx';
import { ColumnMap } from '../components/newaudit/ColumnMap.jsx';
import { ProgressBar } from '../components/newaudit/ProgressBar.jsx';
import { ShimmerButton } from '../components/ui/ShimmerButton.jsx';

function runHint({ count, limit, user }) {
  if (!count) return { over: false, text: 'Upload a sheet or paste URLs to begin.' };
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
  const [sheet, setSheet] = useState(null);
  const [mapping, setMapping] = useState(null);
  const [pasteText, setPasteText] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [parseErr, setParseErr] = useState('');
  const { run, running, progress, error, clearError } = useAuditRun({ onReport });

  const onFile = async (file) => {
    setParseErr('');
    try {
      const s = await parseFile(file);
      setSheet(s);
      setMapping(detectMapping(s.columns));
    } catch (e) {
      setParseErr(`Couldn't parse "${file.name}": ${e.message}`);
    }
  };

  const count = sheet ? auditableRows(sheet, mapping).length : parsePaste(pasteText).length;
  const hint = runHint({ count, limit, user });
  const shownErr = parseErr || error;

  return (
    <div className="animate-fade-up">
      <Banner show={!!shownErr} tone="err" onClose={() => { setParseErr(''); clearError(); }}>{shownErr}</Banner>

      <div className="card p-6">
        <label className="mb-2.5 block font-mono text-[11px] uppercase tracking-wider text-muted">
          Upload rules sheet · .xlsx or .csv
        </label>
        <FileDrop onFile={onFile} />
        {sheet && <ColumnMap sheet={sheet} mapping={mapping} onChange={setMapping} />}

        <div className="my-4 text-center font-mono text-[11px] text-faint">
          — or paste URLs directly (no expected-target check) —
        </div>
        <textarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder={'https://www.example.com/old-products\nhttps://www.example.com/legacy/promo'}
          className="min-h-[84px] w-full resize-y rounded-xl border border-line bg-bg p-3 font-mono text-[13px] leading-relaxed text-ink outline-none focus:border-aem"
        />

        <div className="mt-4">
          <label className="mb-2 block font-mono text-[11px] uppercase tracking-wider text-muted">
            Base URL (optional) — resolves relative paths like <code className="text-aem">/old-products</code>
          </label>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://www.example.com"
            className="w-full rounded-xl border border-line bg-bg px-3 py-2.5 font-mono text-[13px] text-ink outline-none focus:border-aem"
          />
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-4">
          <ShimmerButton onClick={() => run({ sheet, mapping, pasteText, baseUrl, user, limit })} disabled={running || hint.over}>
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
