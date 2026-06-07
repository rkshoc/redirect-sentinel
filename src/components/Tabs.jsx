import { motion } from 'framer-motion';
import { cn } from '../lib/cn.js';

const TABS = ['New audit', 'Report', 'History'];

// Aceternity-style tabs with an animated active pill (shared layout via layoutId).
export function Tabs({ active, onChange }) {
  return (
    <div className="mt-6 flex gap-1 border-b border-line">
      {TABS.map((label, i) => (
        <button
          key={label}
          onClick={() => onChange(i)}
          className={cn(
            'relative px-4 py-2.5 font-mono text-[13px] transition-colors',
            active === i ? 'text-ink' : 'text-muted hover:text-ink',
          )}
        >
          {label}
          {active === i && (
            <motion.span
              layoutId="tab-underline"
              className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-ak to-aem"
              transition={{ type: 'spring', stiffness: 400, damping: 32 }}
            />
          )}
        </button>
      ))}
    </div>
  );
}
