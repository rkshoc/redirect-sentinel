// Adaptive, domain-aware batching — see CLAUDE.md §3.
//
// The Akamai WAF rate-limits by *volume per window*, and that window is counted
// PER PROPERTY (i.e. per domain): ~30–40 requests to one domain in a burst is
// fine, 50–60+ trips 403s. Requests to *different* domains hit *different* WAFs,
// so they don't share a budget.
//
// Therefore we keep the conservative discipline PER DOMAIN (batch under the
// ceiling, low concurrency, cool down between batches) but run different domains
// in PARALLEL up to a global cap. A mixed-domain input — where each domain only
// sees a handful of URLs — then runs at near-full parallelism instead of being
// throttled as if it were one big single-domain burst. A single-domain input
// still gets the exact same safe pacing as before.

export const BATCH_DEFAULTS = {
  batchSize: 30, // per-domain burst ceiling — safely under the ~40 WAF limit
  concurrency: 4, // per-domain in-flight requests
  cooldownMs: 4000, // pause between per-domain batches
  maxInFlight: 16, // global cap on total simultaneous requests across all domains
};

export function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A small allow-list of two-level public suffixes so e.g. `shop.brand.co.uk`
// and `www.brand.co.uk` group under the same registrable domain `brand.co.uk`
// (same Akamai property → shared WAF budget).
const TWO_LEVEL_TLDS = new Set([
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'me.uk', 'ltd.uk', 'plc.uk',
  'com.au', 'net.au', 'org.au', 'co.nz', 'co.za', 'co.jp', 'or.jp', 'ne.jp',
  'com.br', 'com.mx', 'com.ar', 'com.sg', 'com.hk', 'co.in', 'com.tr',
]);

// registrable domain (eTLD+1, heuristic) — the WAF-relevant grouping key.
export function registrableDomain(host) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  const parts = h.split('.');
  if (parts.length <= 2) return h;
  const last2 = parts.slice(-2).join('.');
  if (TWO_LEVEL_TLDS.has(last2)) return parts.slice(-3).join('.');
  return last2;
}

// Default grouping key: the registrable domain of an item's source URL. Items
// without a parseable URL each fall back to their own stable key.
function defaultKeyOf(item) {
  const src = typeof item === 'string' ? item : item && item.source;
  if (!src) return '*';
  try {
    return registrableDomain(new URL(src).hostname);
  } catch {
    return String(src);
  }
}

/**
 * Process every item with WAF-friendly, domain-aware batching.
 *
 * Per domain: at most `concurrency` requests in flight, and a `cooldownMs` pause
 * after every `batchSize` requests. Across domains: up to `maxInFlight` requests
 * run simultaneously. Results are returned in input order.
 *
 * @param {Array} items
 * @param {(item:any, globalIndex:number)=>Promise<any>} worker
 * @param {object} [opts]
 * @param {number} [opts.batchSize]      per-domain burst ceiling
 * @param {number} [opts.concurrency]    per-domain in-flight
 * @param {number} [opts.cooldownMs]     pause between per-domain batches
 * @param {number} [opts.maxInFlight]    global in-flight cap across all domains
 * @param {(item:any, i:number)=>string} [opts.keyOf] override the grouping key
 * @param {(p:{done:number,total:number,domains:number})=>void} [opts.onProgress]
 * @returns {Promise<Array>} results in input order
 */
export async function runBatched(items, worker, opts = {}) {
  const cfg = { ...BATCH_DEFAULTS, ...opts };
  const keyOf = opts.keyOf || defaultKeyOf;
  const results = new Array(items.length);
  const total = items.length;
  let done = 0;

  // Group item *indices* by domain, preserving original order within a group.
  const groups = new Map(); // key -> { queue:number[], inFlight, since, cooldownUntil }
  items.forEach((item, i) => {
    const k = keyOf(item, i);
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { queue: [], inFlight: 0, since: 0, cooldownUntil: 0 }));
    g.queue.push(i);
  });

  // Pick the next runnable item. Returns {idx, group}, or {wait} if everything
  // pending is currently saturated/cooling, or {finished:true} when all done.
  // Synchronous: the caller bumps inFlight before any await, so this is atomic.
  function pick() {
    let pending = false;
    let soonest = Infinity;
    for (const g of groups.values()) {
      if (g.queue.length === 0) continue;
      pending = true;
      if (g.inFlight >= cfg.concurrency) continue;
      const now = Date.now();
      if (g.cooldownUntil > now) { soonest = Math.min(soonest, g.cooldownUntil); continue; }
      g.inFlight++;
      return { idx: g.queue.shift(), group: g };
    }
    if (!pending) return { finished: true };
    const waitFor = soonest === Infinity ? 20 : Math.max(5, soonest - Date.now());
    return { wait: waitFor };
  }

  async function runner() {
    while (true) {
      const p = pick();
      if (p.finished) return;
      if (p.wait != null) { await sleep(p.wait); continue; }
      const { idx, group } = p;
      try {
        results[idx] = await worker(items[idx], idx);
      } finally {
        group.inFlight--;
        done++;
        // Cool the domain down after each full batch, if more work remains.
        if (++group.since >= cfg.batchSize && group.queue.length > 0) {
          group.cooldownUntil = Date.now() + cfg.cooldownMs;
          group.since = 0;
        }
        if (opts.onProgress) opts.onProgress({ done, total, domains: groups.size });
      }
    }
  }

  const poolSize = Math.max(1, Math.min(cfg.maxInFlight, total));
  await Promise.all(Array.from({ length: poolSize }, runner));
  return results;
}
