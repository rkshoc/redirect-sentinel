import { createContext, useContext, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

const THEME_KEY = 'rs-theme';
const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  // The pre-paint script in index.html already set data-theme; mirror it here.
  const [theme, setTheme] = useState(() => {
    if (typeof document !== 'undefined') {
      return document.documentElement.getAttribute('data-theme') || 'dark';
    }
    return 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  const apply = (next) => {
    document.documentElement.setAttribute('data-theme', next); // sync, for the VT snapshot
    setTheme(next);
  };

  // Magic UI "Animated Theme Toggler": reveal the new theme with a circular wipe
  // expanding from the toggle button, via the View Transitions API. Falls back
  // to an instant switch when unsupported or reduced-motion is requested.
  const toggle = (event) => {
    const next = (document.documentElement.getAttribute('data-theme') || 'dark') === 'light' ? 'dark' : 'light';
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (typeof document === 'undefined' || !document.startViewTransition || reduce) { apply(next); return; }

    const x = event?.clientX ?? window.innerWidth - 40;
    const y = event?.clientY ?? 40;
    const endRadius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));

    const vt = document.startViewTransition(() => flushSync(() => apply(next)));
    vt.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`] },
        { duration: 520, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', pseudoElement: '::view-transition-new(root)' },
      );
    }).catch(() => { /* a superseded transition is fine */ });
  };

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
