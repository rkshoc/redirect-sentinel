import { motion } from 'framer-motion';
import { Globe, Server, Flag, Check, X, Ban } from 'lucide-react';
import { SERVER_LABEL } from '../../lib/verdict.js';
import { cn } from '../../lib/cn.js';

// Plain-English meaning of an HTTP status, for non-technical readers.
function statusMeaning(code) {
  if (!code) return 'No response';
  if (code === 301 || code === 308) return 'Permanent redirect';
  if (code === 302 || code === 307) return 'Temporary redirect';
  if (code === 200) return 'Page loaded (OK)';
  if (code === 403 || code === 429) return 'Blocked';
  if (code === 404) return 'Page not found';
  if (code >= 500) return 'Server error';
  if (code >= 400) return 'Request error';
  if (code >= 300) return 'Redirect';
  return 'OK';
}

function statusTone(code) {
  if (code === 301 || code === 308 || code === 200) return 'text-pass border-pass/40 bg-pass/10';
  if (code === 302 || code === 307) return 'text-warn border-warn/40 bg-warn/10';
  if (code === 403 || code === 429) return 'text-blocked border-blocked/40 bg-blocked/10';
  return 'text-fail border-fail/40 bg-fail/10';
}
// The colour that "flows" along the connector leaving this hop.
function flowColor(code) {
  if (code === 301 || code === 308) return 'rgb(var(--pass))';
  if (code === 302 || code === 307) return 'rgb(var(--warn))';
  return 'rgb(var(--aem))';
}

function parts(url) {
  try { const u = new URL(url); return { host: u.host, path: (u.pathname + u.search) || '/' }; }
  catch { return { host: '', path: url || '—' }; }
}

const SRV_DOT = { akamai: 'bg-ak', dispatcher: 'bg-aem', origin: 'bg-origin', unknown: 'bg-unknown' };

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12, delayChildren: 0.05 } },
};
const item = {
  hidden: { opacity: 0, y: 10, scale: 0.95 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 320, damping: 26 } },
};

// A connector with a light "packet" flowing in the direction of the redirect.
function Connector({ code }) {
  const color = flowColor(code);
  return (
    <motion.div variants={item} className="flex w-12 shrink-0 flex-col items-center justify-center gap-1 self-center">
      <div className="relative h-[3px] w-full overflow-hidden rounded-full bg-line">
        <motion.div
          className="absolute inset-y-0 w-1/3 rounded-full"
          style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }}
          animate={{ x: ['-120%', '320%'] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>
      <span className="font-mono text-[9px] text-faint">{code || '—'}</span>
    </motion.div>
  );
}

// Friendly left-to-right map of the redirect: Source → … → Destination, each hop
// colour-coded with its status in plain English (CLAUDE.md §6 display).
export function HopJourney({ row }) {
  const hops = row.hops || [];
  if (!hops.length) return null;
  const verdict = row.verdict;
  const endIcon = verdict === 'PASS' ? Check : verdict === 'BLOCKED' ? Ban : verdict === 'FAIL' ? X : Flag;
  const endTone =
    verdict === 'PASS' ? 'border-pass/50 text-pass' :
    verdict === 'FAIL' ? 'border-fail/50 text-fail' :
    verdict === 'BLOCKED' ? 'border-blocked/50 text-blocked' : 'border-info/50 text-info';

  return (
    <div className="mb-4">
      <div className="mb-2.5 font-mono text-[10px] uppercase tracking-wider text-faint">Redirect journey</div>
      <motion.div variants={container} initial="hidden" animate="show" className="flex items-stretch gap-1 overflow-x-auto pb-2">
        {hops.map((h, i) => {
          const last = i === hops.length - 1;
          const { host, path } = parts(h.url);
          const Icon = i === 0 ? Globe : last ? endIcon : Server;
          const label = i === 0 ? 'Source' : last ? 'Destination' : `Step ${i + 1}`;
          return (
            <div key={i} className="flex items-stretch gap-1">
              <motion.div
                variants={item}
                whileHover={{ y: -3 }}
                className={cn('flex w-[184px] shrink-0 flex-col gap-1.5 rounded-xl border bg-bg/70 p-3 transition-shadow hover:shadow-lg hover:shadow-aem/10', last ? endTone : 'border-line')}
              >
                <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-muted">
                  <span className="relative grid h-5 w-5 place-items-center">
                    {i === 0 && <span className="absolute inset-0 rounded-full bg-aem/30" style={{ animation: 'pulse-ring 1.8s ease-out infinite' }} />}
                    <Icon size={13} className={cn('relative', last ? '' : i === 0 ? 'text-aem' : 'text-faint')} />
                  </span>
                  {label}
                </div>
                <div title={h.url} className="truncate font-mono text-[12px] font-semibold text-ink">{path}</div>
                {host && <div title={h.url} className="truncate font-mono text-[10px] text-faint">{host}</div>}
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className={cn('rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold', statusTone(h.status))}>
                    {h.status || h.error || 'err'}
                  </span>
                  <span className="font-mono text-[10px] text-muted">{statusMeaning(h.status)}</span>
                </div>
                <div className="flex items-center gap-1.5 font-mono text-[9.5px] text-faint">
                  <span className={cn('h-1.5 w-1.5 rounded-full', SRV_DOT[h.server] || SRV_DOT.unknown)} />
                  {SERVER_LABEL[h.server] || h.server}
                </div>
              </motion.div>
              {!last && <Connector code={h.status} />}
            </div>
          );
        })}
      </motion.div>
    </div>
  );
}
