// Aceternity-style animated aurora + grid backdrop. Cheap (CSS gradients + blur),
// fixed behind everything. Animation is paused via the `still` prop when a large
// data grid is mounted, to avoid compositing jank.
const BLOBS = [
  { cls: 'left-1/4 -top-1/4 bg-aem/25', size: 'h-[55vh] w-[55vh]', dur: '19s', delay: '0s' },
  { cls: 'right-1/5 top-0 bg-ak/20', size: 'h-[46vh] w-[46vh]', dur: '23s', delay: '-7s' },
  { cls: 'left-1/3 bottom-0 bg-origin/20', size: 'h-[48vh] w-[48vh]', dur: '27s', delay: '-13s' },
  { cls: 'right-1/3 bottom-1/4 bg-aem/10', size: 'h-[38vh] w-[38vh]', dur: '17s', delay: '-4s' },
];

export function PageBackground({ still = false }) {
  return (
    <div aria-hidden className="fixed inset-0 -z-10 overflow-hidden bg-bg">
      {BLOBS.map((b, i) => (
        <div
          key={i}
          className={`absolute rounded-full blur-[130px] ${b.size} ${b.cls} ${still ? '' : 'animate-aurora'}`}
          style={still ? undefined : { animationDuration: b.dur, animationDelay: b.delay }}
        />
      ))}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            'linear-gradient(rgb(var(--ink)) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--ink)) 1px, transparent 1px)',
          backgroundSize: '42px 42px',
          maskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, #000 35%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, #000 35%, transparent 100%)',
        }}
      />
    </div>
  );
}
