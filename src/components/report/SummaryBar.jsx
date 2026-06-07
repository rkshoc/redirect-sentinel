import { Check, Clock } from 'lucide-react';
import { NumberTicker } from '../ui/NumberTicker.jsx';
import { formatLocal } from '../../lib/format.js';

const STATS = [
  { key: 'checked', label: 'Checked', color: 'text-ink' },
  { key: 'passed', label: 'Passed', color: 'text-pass' },
  { key: 'failed', label: 'Failed', color: 'text-fail' },
  { key: 'blocked', label: 'Blocked', color: 'text-blocked' },
  { key: 'deepChecked', label: 'Deep-checked', color: 'text-info' },
];

// Compact, data-dense summary strip (bento-ish) with animated counters.
export function SummaryBar({ summary, filename, createdUtc }) {
  const s = summary || {};
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-line bg-panel/70 px-5 py-4 backdrop-blur-sm">
      {STATS.map((st) => (
        <div key={st.key} className="flex items-baseline gap-2">
          <NumberTicker value={s[st.key] || 0} className={`font-mono text-2xl font-bold ${st.color}`} />
          <span className="font-mono text-[11px] uppercase tracking-wide text-muted">{st.label}</span>
        </div>
      ))}
      {createdUtc && (
        <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[11px] text-muted" title={`${createdUtc} (UTC)`}>
          <Clock size={13} /> ran {formatLocal(createdUtc)}
        </span>
      )}
      {filename && (
        <span className={`${createdUtc ? '' : 'ml-auto'} inline-flex items-center gap-1.5 font-mono text-[11px] text-pass`} title={filename}>
          <Check size={13} /> archived
        </span>
      )}
    </div>
  );
}
