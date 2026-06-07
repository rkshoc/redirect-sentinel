import { CornerDownRight } from 'lucide-react';
import { SERVER_LABEL } from '../../lib/verdict.js';
import { cn } from '../../lib/cn.js';

function statusTone(code) {
  if (code === 301 || code === 308) return 'bg-pass/15 text-pass';
  if (code === 302 || code === 307) return 'bg-warn/15 text-warn';
  if (code === 200) return 'bg-info/15 text-info';
  if (code === 403 || code === 429) return 'bg-blocked/15 text-blocked';
  return 'bg-fail/15 text-fail';
}

const SRV_TONE = {
  akamai: 'border-ak/30 bg-ak/10 text-ak',
  dispatcher: 'border-aem/30 bg-aem/10 text-aem',
  origin: 'border-origin/30 bg-origin/10 text-origin',
  unknown: 'border-line text-unknown',
};

export function HopChain({ hops }) {
  if (!hops || !hops.length) return null;
  return (
    <div>
      <div className="mb-2.5 mt-1 font-mono text-[10px] uppercase tracking-wider text-faint">Hop chain</div>
      {hops.map((h, i) => {
        const last = i === hops.length - 1;
        return (
          <div key={i} className="flex gap-3 border-b border-line py-2.5 last:border-0">
            <div className="w-9 shrink-0 pt-0.5 font-mono text-[10px] text-faint">{h.n}</div>
            <div className="min-w-0 flex-1">
              <div className="mb-1.5 break-all font-mono text-[11.5px]">
                {i > 0 && <CornerDownRight size={11} className="mr-1 inline text-faint" />}
                {h.url}
                {last && <span className="text-faint"> (final)</span>}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={cn('rounded px-1.5 py-0.5 font-mono text-[10px] font-medium', statusTone(h.status))}>
                  {h.status || h.error || 'err'}
                </span>
                <span className={cn('rounded border px-1.5 py-0.5 font-mono text-[10px]', SRV_TONE[h.server] || SRV_TONE.unknown)}>
                  {SERVER_LABEL[h.server] || h.server}
                </span>
                <span className="ml-auto font-mono text-[10px] text-faint">{h.timeMs}ms</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
