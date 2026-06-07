import { Moon, Sun, LogIn, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { maskEmail } from '../lib/format.js';

export function Header() {
  const { user, role, limit, loggedIn, login, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const limLabel = limit === Infinity ? 'unlimited' : `≤${limit} URLs`;

  return (
    <header className="flex flex-wrap items-center gap-3 py-1">
      <div className="flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-ak to-aem text-lg font-black text-white shadow-lg shadow-aem/20">
          R
        </div>
        <div>
          <div className="text-xl font-extrabold leading-none">
            <span className="gradient-brand">Redirect·Sentinel</span>
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
            AEM · Akamai contract test
          </div>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2 font-mono text-xs">
        {loggedIn ? (
          <>
            <span className="rounded-full border border-aem/40 px-3 py-1 text-aem">{role || 'member'}</span>
            <span className="hidden text-faint sm:inline">{limLabel} · {maskEmail(user.email)}</span>
            <button
              onClick={logout}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-muted transition hover:border-aem hover:text-ink"
            >
              <LogOut size={13} /> Log out
            </button>
          </>
        ) : (
          <>
            <span className="text-faint">not logged in · ≤10 URLs</span>
            <button
              onClick={login}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-muted transition hover:border-aem hover:text-ink"
            >
              <LogIn size={13} /> Log in
            </button>
          </>
        )}
        <button
          onClick={toggle}
          title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
          aria-label="Toggle theme"
          className="grid h-8 w-8 place-items-center rounded-lg border border-line text-muted transition hover:border-aem hover:text-ink"
        >
          {theme === 'light' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>
    </header>
  );
}
