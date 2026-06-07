import { motion } from 'framer-motion';
import { cn } from '../../lib/cn.js';

// Magic UI-style shimmer button — a moving light band over an animated brand
// gradient, with a tactile hover/press and a soft glow.
export function ShimmerButton({ className, children, disabled, ...props }) {
  return (
    <motion.button
      {...props}
      disabled={disabled}
      whileHover={disabled ? undefined : { scale: 1.03, y: -1 }}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 400, damping: 22 }}
      className={cn(
        'group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-xl px-6 py-3',
        'text-sm font-semibold text-white transition-shadow',
        'bg-gradient-to-r from-ak via-ak to-aem bg-[length:200%_auto] shadow-lg shadow-ak/30',
        'hover:shadow-xl hover:shadow-ak/40 disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      style={{ animation: disabled ? undefined : 'gradient-x 5s ease infinite' }}
    >
      <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent animate-shimmer" />
      <span className="relative z-10 inline-flex items-center gap-2">{children}</span>
    </motion.button>
  );
}
