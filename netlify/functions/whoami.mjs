// whoami — sync function that resolves the caller's Netlify Identity (which is
// only available to sync functions via clientContext) and returns a short-lived
// server-SIGNED identity token. The browser passes this token to the
// audit-background worker so it can trust the identity without clientContext,
// while limits stay un-forgeable (CLAUDE.md §4).

import { resolveIdentity, signIdentity } from './lib/auth.mjs';

export const handler = async (event, context) => {
  const id = resolveIdentity(context.clientContext);
  const token = signIdentity(id); // null when anonymous
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({
      loggedIn: id.loggedIn,
      user: id.user,
      role: id.role,
      limit: id.limit === Infinity ? 'unlimited' : id.limit,
      token,
    }),
  };
};
