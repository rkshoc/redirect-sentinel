import { reasonInfo } from '../../lib/verdict.js';
import { cn } from '../../lib/cn.js';

const TONES = {
  ok: 'border-pass/20 bg-pass/[0.07] text-pass',
  bad: 'border-fail/20 bg-fail/[0.07] text-fail',
  warn: 'border-warn/20 bg-warn/[0.07] text-warn',
  info: 'border-info/20 bg-info/[0.07] text-info',
};

// Verdict explanation + (when an expected target exists) the expected-vs-actual diff.
export function ReasonBlock({ row }) {
  const { tone, text } = reasonInfo(row);
  const good = row.verdict === 'PASS';
  return (
    <div>
      <div className={cn('mb-3 rounded-lg border px-3 py-2 font-mono text-[11.5px] leading-relaxed', TONES[tone])}>
        {text}
      </div>
      {row.expected && (
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-aem/30 bg-bg p-3">
            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted">Expected</div>
            <div className="break-all font-mono text-[12.5px] leading-relaxed">{row.expected}</div>
          </div>
          <div className={cn('rounded-lg border bg-bg p-3', good ? 'border-pass/40' : 'border-fail/40')}>
            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted">Actual final</div>
            <div className="break-all font-mono text-[12.5px] leading-relaxed">
              {row.finalUrl}
              {row.finalStatus && row.verdict === 'FAIL' && row.reason === 'broken' ? ` · ${row.finalStatus}` : ''}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
