import { createContext, useContext, useEffect, useState } from 'react';
import netlifyIdentity from 'netlify-identity-widget';

// Tier limits mirror server lib/auth.mjs for UX only — the server is authoritative.
export const ROLE_LIMITS = { owner: Infinity, admin: 100, advanced: 55, basic: 30 };
export const ANON_LIMIT = 10;

export function resolveRole(user) {
  if (!user) return { role: null, limit: ANON_LIMIT };
  const roles = (user.app_metadata?.roles || []).map((r) => String(r).toLowerCase());
  const order = ['owner', 'admin', 'advanced', 'basic'];
  const role = order.find((r) => roles.includes(r)) || null;
  return { role, limit: role ? ROLE_LIMITS[role] : ROLE_LIMITS.basic };
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);

  useEffect(() => {
    netlifyIdentity.on('init', (u) => setUser(u || null));
    netlifyIdentity.on('login', (u) => { setUser(u || null); netlifyIdentity.close(); });
    netlifyIdentity.on('logout', () => setUser(null));
    netlifyIdentity.init();
    return () => {
      netlifyIdentity.off('init');
      netlifyIdentity.off('login');
      netlifyIdentity.off('logout');
    };
  }, []);

  const { role, limit } = resolveRole(user);
  const value = {
    user,
    role,
    limit,
    loggedIn: !!user,
    login: () => netlifyIdentity.open(),
    logout: () => netlifyIdentity.logout(),
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
