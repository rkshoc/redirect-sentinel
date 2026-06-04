// HTTP redirect-following engine — see CLAUDE.md §3, §6.
//
// Follows a source URL hop-by-hop with manual redirect handling, capturing
// status, timing and a server/edge tag per hop. Uses the global fetch in
// Node 18+ (no dependency). Sends realistic browser-like headers to close most
// of the gap with a real browser (cheap; CLAUDE.md §3).

import { tagServer } from './servertag.mjs';

// Realistic browser-like request headers. The WAF problem is volume-based rate
// limiting, not fingerprinting (CLAUDE.md §3), so we don't need tricks — just a
// plausible, honest browser signature.
export const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

const DEFAULTS = {
  maxHops: 10,
  perHopTimeoutMs: 12000,
};

// Resolve a Location header (may be relative) against the current URL.
function resolveLocation(location, base) {
  try {
    return new URL(location, base).toString();
  } catch {
    return null;
  }
}

/**
 * Trace the redirect chain for a single source URL.
 *
 * @param {string} source
 * @param {object} [opts]
 * @returns {Promise<{
 *   source:string, finalUrl:string|null, finalStatus:number|null,
 *   hopCount:number, blocked:boolean, loop:boolean, error:(string|null),
 *   hops:Array<{n:number,url:string,status:number|null,server:string,
 *               location:string|null,timeMs:number}>
 * }>}
 */
export async function trace(source, opts = {}) {
  const { maxHops, perHopTimeoutMs } = { ...DEFAULTS, ...opts };
  const hops = [];
  const seen = new Set();
  let current = source;
  let blocked = false;
  let loop = false;
  let error = null;

  for (let i = 0; i < maxHops; i++) {
    if (seen.has(current)) { loop = true; break; }
    seen.add(current);

    const started = Date.now();
    let res;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), perHopTimeoutMs);
    try {
      res = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        headers: BROWSER_HEADERS,
        signal: ac.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      error = e?.name === 'AbortError' ? 'timeout' : (e?.message || 'fetch failed');
      hops.push({ n: i + 1, url: current, status: null, server: 'unknown', location: null, timeMs: Date.now() - started });
      break;
    }
    clearTimeout(timer);

    const timeMs = Date.now() - started;
    const status = res.status;
    const server = tagServer(res.headers);
    const location = res.headers.get('location');
    const resolved = location ? resolveLocation(location, current) : null;

    hops.push({ n: i + 1, url: current, status, server, location: resolved, timeMs });

    // WAF block / challenge → inconclusive. Flag for the Playwright fallback.
    // 429 (rate limited) is treated the same — a different IP may clear it.
    if (status === 403 || status === 429) { blocked = true; break; }

    // A redirect with a usable Location → follow it.
    const isRedirect = status >= 300 && status < 400 && resolved;
    if (isRedirect) {
      current = resolved;
      continue;
    }

    // Terminal (2xx, 4xx/5xx, or 3xx without Location).
    break;
  }

  if (hops.length >= maxHops && !blocked && !error) {
    // Hit the hop cap without terminating — treat as loop / too many hops.
    const last = hops[hops.length - 1];
    if (last && last.status >= 300 && last.status < 400) loop = true;
  }

  const last = hops[hops.length - 1] || null;
  return {
    source,
    finalUrl: last ? last.url : null,
    finalStatus: last ? last.status : null,
    hopCount: hops.length,
    blocked,
    loop,
    error,
    hops,
  };
}
