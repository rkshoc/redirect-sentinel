// Playwright redirect tracer — drives a real browser through a redirect chain,
// capturing each hop's URL, status, server/edge tag, Location and timing
// (CLAUDE.md §3, §6). A real browser from a fresh GitHub-runner IP clears the
// volume throttle most of the time and resolves JS-based redirects too.

import { tagServer } from '../../../netlify/functions/lib/servertag.mjs';

/**
 * @param {import('playwright').BrowserContext} context
 * @param {string} url
 * @returns {Promise<{source,finalUrl,finalStatus,hopCount,blocked,loop,error,hops}>}
 */
export async function traceBrowser(context, url, { timeoutMs = 45000 } = {}) {
  const page = await context.newPage();
  try {
    const resp = await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
    // Walk the redirect chain back to the original request.
    const reqs = [];
    let req = resp ? resp.request() : null;
    while (req) { reqs.unshift(req); req = req.redirectedFrom(); }
    let n = 0;
    const hops = [];
    let blocked = false;
    for (const r of reqs) {
      const rr = await r.response();
      const headers = rr ? rr.headers() : {};
      const status = rr ? rr.status() : null;
      let timeMs = 0;
      try { const t = r.timing(); if (t && t.responseEnd > 0) timeMs = Math.round(t.responseEnd); } catch { /* ignore */ }
      hops.push({ n: ++n, url: r.url(), status, server: tagServer(headers), location: headers.location || null, timeMs });
      if (status === 403 || status === 429) blocked = true;
    }
    const last = hops[hops.length - 1] || null;
    return {
      source: url,
      finalUrl: page.url(),
      finalStatus: last ? last.status : null,
      hopCount: hops.length,
      blocked,
      loop: false,
      error: null,
      hops,
    };
  } catch (e) {
    return { source: url, finalUrl: null, finalStatus: null, hopCount: 0, blocked: false, loop: false, error: e.message, hops: [] };
  } finally {
    await page.close().catch(() => {});
  }
}
