import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Info, X } from 'lucide-react';
import { cn } from '../lib/cn.js';

const TONES = {
  err: 'border-fail/30 bg-fail/10 text-fail',
  ok: 'border-pass/30 bg-pass/10 text-pass',
  info: 'border-info/30 bg-info/10 text-info',
  warn: 'border-blocked/30 bg-blocked/10 text-blocked',
};

// Inline callout for errors + the partial-report notice.
export function Banner({ show, tone = 'info', children, onClose }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          className={cn('mb-4 flex items-start gap-2 rounded-xl border px-4 py-2.5 font-mono text-xs', TONES[tone])}
        >
          {tone === 'err' || tone === 'warn' ? <AlertTriangle size={15} className="mt-0.5 shrink-0" /> : <Info size={15} className="mt-0.5 shrink-0" />}
          <div className="flex-1">{children}</div>
          {onClose && (
            <button onClick={onClose} className="shrink-0 opacity-70 hover:opacity-100" aria-label="Dismiss">
              <X size={14} />
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
