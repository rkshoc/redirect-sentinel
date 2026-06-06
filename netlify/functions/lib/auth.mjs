// Auth & tiers — see CLAUDE.md §4.
//
// Limits are enforced SERVER-SIDE. Even if the frontend is edited, the Function
// rejects over-limit requests. Identity comes from Netlify Identity: a sync
// function's context.clientContext.user is populated from the verified JWT.
//
// Background functions do NOT receive clientContext, and Netlify only executes
// them on a direct (external) HTTP trigger — so the browser calls the worker
// directly and carries a short-lived, server-SIGNED identity token issued by
// the sync /api/whoami endpoint. signIdentity/verifyIdentity (HMAC over a server
// secret the browser never sees) let the worker trust that identity without
// clientContext, while keeping limits un-forgeable.

import crypto from 'node:crypto';

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

// Shared secret for signing identity tokens. Never sent to the browser. Falls
// back to GITHUB_TOKEN so no extra env var is required.
function signingSecret() {
  return process.env.INTERNAL_TOKEN || process.env.GITHUB_TOKEN || '';
}

/**
 * Issue a short-lived signed token attesting a verified identity. Called by the
 * sync /api/whoami (which has clientContext). The worker verifies it instead of
 * trusting raw browser claims.
 */
export function signIdentity(identity, ttlMs = 10 * 60 * 1000) {
  const secret = signingSecret();
  if (!secret || !identity || !identity.loggedIn) return null;
  const claims = {
    user: identity.user,
    roles: identity.roles || [],
    role: identity.role || null,
    limit: identity.limit === Infinity ? 'inf' : identity.limit,
    exp: Date.now() + ttlMs,
  };
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/**
 * Verify a token from signIdentity. Returns an identity object (same shape as
 * resolveIdentity) or null if missing/invalid/expired.
 */
export function verifyIdentity(token) {
  const secret = signingSecret();
  if (!secret || !token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let claims;
  try { claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (!claims.exp || Date.now() > claims.exp) return null;
  return {
    loggedIn: true,
    user: claims.user,
    roles: claims.roles || [],
    role: claims.role || null,
    limit: claims.limit === 'inf' ? Infinity : claims.limit,
  };
}
