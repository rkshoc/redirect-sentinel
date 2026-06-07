// Aceternity-style animated aurora + grid backdrop. Cheap (CSS gradients + blur),
// fixed behind everything. Animation is paused via the `still` prop when a large
// data grid is mounted, to avoid compositing jank.
export function PageBackground({ still = false }) {
  const anim = still ? '' : 'animate-aurora';
  return (
    <div aria-hidden className="fixed inset-0 -z-10 overflow-hidden bg-bg">
      <div className={`absolute -top-1/4 left-1/4 h-[55vh] w-[55vh] rounded-full bg-aem/25 blur-[130px] ${anim}`} />
      <div className={`absolute top-0 right-1/5 h-[45vh] w-[45vh] rounded-full bg-ak/20 blur-[130px] ${anim}`} style={{ animationDelay: '-6s' }} />
      <div className={`absolute bottom-0 left-1/3 h-[45vh] w-[45vh] rounded-full bg-origin/20 blur-[130px] ${anim}`} style={{ animationDelay: '-12s' }} />
      <div
        className="absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            'linear-gradient(rgb(var(--ink)) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--ink)) 1px, transparent 1px)',
          backgroundSize: '42px 42px',
          maskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, #000 40%, transparent 100%)',
        }}
      />
    </div>
  );
}
