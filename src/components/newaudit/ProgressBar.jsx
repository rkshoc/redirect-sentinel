import { Loader2 } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

// Live progress: real elapsed + estimated ETA/bar (the background worker can't
// stream). Skinned with a brand gradient fill.
export function ProgressBar({ progress }) {
  return (
    <AnimatePresence>
      {progress.show && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="mt-5 overflow-hidden"
        >
          <div className="mb-2.5 flex items-center gap-2 font-mono text-[12.5px] text-ink">
            <Loader2 size={14} className="animate-spin text-aem" /> {progress.phase}
          </div>
          <div className="h-2 overflow-hidden rounded-full border border-line bg-bg">
            <div
              className="h-full rounded-full bg-gradient-to-r from-aem to-ak transition-[width] duration-300"
              style={{ width: `${progress.fillPct}%` }}
            />
          </div>
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 font-mono text-[11px] text-faint">
            <span><b className="text-muted">{progress.total}</b> URLs</span>
            <span><b className="text-muted">{progress.batches}</b> batches · ~30/batch</span>
            <span>elapsed <b className="text-muted">{progress.elapsed}</b></span>
            <span>~<b className="text-muted">{progress.eta}</b> left</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
