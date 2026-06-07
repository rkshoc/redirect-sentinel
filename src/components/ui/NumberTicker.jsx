import { useEffect, useState } from 'react';

// Magic UI-style count-up. Eases from 0 to `value` on mount/change.
export function NumberTicker({ value = 0, className }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const to = Number(value) || 0;
    const dur = 650;
    let raf;
    const start = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - start) / dur);
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className={className}>{n}</span>;
}
