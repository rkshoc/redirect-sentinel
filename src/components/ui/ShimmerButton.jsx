import { cn } from '../../lib/cn.js';

// Magic UI-style shimmer button — a moving light band over a brand gradient.
export function ShimmerButton({ className, children, ...props }) {
  return (
    <button
      {...props}
      className={cn(
        'group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-xl px-6 py-3',
        'text-sm font-semibold text-white shadow-lg shadow-ak/20 transition active:scale-[.98]',
        'bg-gradient-to-r from-ak via-ak to-aem disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
    >
      <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/35 to-transparent animate-shimmer" />
      <span className="relative z-10 inline-flex items-center gap-2">{children}</span>
    </button>
  );
}
