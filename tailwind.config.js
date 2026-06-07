/** @type {import('tailwindcss').Config} */
// Colors are driven by CSS variables (RGB channel triplets) defined per theme in
// src/index.css, exposed here via rgb(var(--x) / <alpha-value>) so opacity
// modifiers (e.g. bg-fail/10) work. This keeps the dark/light theme switch and
// the verdict palette in CSS — Tailwind never purges a runtime-built color.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'),
        panel: v('panel'),
        panel2: v('panel2'),
        line: v('line'),
        line2: v('line2'),
        ink: v('ink'),
        muted: v('muted'),
        faint: v('faint'),
        ak: v('ak'),
        aem: v('aem'),
        origin: v('origin'),
        unknown: v('unknown'),
        pass: v('pass'),
        fail: v('fail'),
        warn: v('warn'),
        blocked: v('blocked'),
        info: v('info'),
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      keyframes: {
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        aurora: {
          '0%,100%': { transform: 'translate(-8%,-6%) scale(1)' },
          '50%': { transform: 'translate(8%,6%) scale(1.12)' },
        },
        beam: { '100%': { 'offset-distance': '100%' } },
        'fade-up': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
        spin: { to: { transform: 'rotate(360deg)' } },
      },
      animation: {
        shimmer: 'shimmer 2.2s infinite',
        aurora: 'aurora 18s ease-in-out infinite',
        'fade-up': 'fade-up .35s ease both',
        spin: 'spin 1s linear infinite',
      },
    },
  },
  plugins: [],
};
