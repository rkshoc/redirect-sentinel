// Auth & tiers — see CLAUDE.md §4.
//
// Limits are enforced SERVER-SIDE here. Even if the frontend is edited, the
// Function rejects over-limit requests. Identity comes from Netlify Identity:
// the gateway verifies the JWT and populates context.clientContext.user. We do
// NOT use env vars as a user database and never ship secrets to the browser.

export const ROLE_LIMITS = {
  owner: Infinity,
  admin: 100,
  advanced: 55, // "50–60" band — pick a safe midpoint
  basic: 30,
};

// Logged-in but no recognised role → treat as basic.
export const DEFAULT_LOGGED_IN_LIMIT = ROLE_LIMITS.basic;

// Not logged in: the ≤10 free path.
export const ANON_LIMIT = 10;

/**
 * Resolve the identity + URL limit for a request.
 *
 * @param {object} clientContext  Netlify function context.clientContext
 * @returns {{loggedIn:boolean, user:string|null, roles:string[], role:string|null, limit:number}}
 */
export function resolveIdentity(clientContext) {
  const user = clientContext && clientContext.user;
  if (!user) {
    return { loggedIn: false, user: null, roles: [], role: null, limit: ANON_LIMIT };
  }

  const appMeta = user.app_metadata || {};
  const roles = Array.isArray(appMeta.roles) ? appMeta.roles.map((r) => String(r).toLowerCase()) : [];

  // Highest-privilege role wins.
  const order = ['owner', 'admin', 'advanced', 'basic'];
  let role = order.find((r) => roles.includes(r)) || null;
  let limit = role ? ROLE_LIMITS[role] : DEFAULT_LOGGED_IN_LIMIT;

  const label = user.email || user.user_metadata?.full_name || user.sub || 'user';
  return { loggedIn: true, user: label, roles, role, limit };
}

/**
 * Enforce the URL-count limit. Returns null if allowed, or an error object.
 *
 * @param {number} count   number of URLs requested
 * @param {object} identity result of resolveIdentity
 */
export function checkLimit(count, identity) {
  // >10 URLs requires login (CLAUDE.md §4).
  if (!identity.loggedIn && count > ANON_LIMIT) {
    return {
      status: 401,
      message: `Log in to audit more than ${ANON_LIMIT} URLs. Anonymous audits are capped at ${ANON_LIMIT}.`,
    };
  }
  if (count > identity.limit) {
    const tier = identity.role || 'your';
    return {
      status: 403,
      message: `Request of ${count} URLs exceeds the ${identity.limit} limit for the ${tier} tier.`,
    };
  }
  return null;
}

// A short, URL-safe id for report filenames.
export function shortId(len = 4) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}
