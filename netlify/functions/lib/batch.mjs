// Adaptive batching — see CLAUDE.md §3.
//
// The Akamai WAF rate-limits by *volume per window*: ~30–40 in a burst is fine,
// 50–60+ trips 403s. So we chunk the input into batches well under the ceiling,
// run low concurrency within a batch, and cool down between batches. Total
// request count per window is what matters.

export const BATCH_DEFAULTS = {
  batchSize: 30, // safely under the ~40 ceiling
  concurrency: 4, // low concurrency within a batch
  cooldownMs: 4000, // short pause between batches
};

export function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Run `worker(item, index)` across `items` with bounded concurrency, preserving
// result order.
async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = new Array(Math.min(concurrency, items.length)).fill(0).map(async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Process every item with WAF-friendly batching.
 *
 * @param {Array} items
 * @param {(item:any, globalIndex:number)=>Promise<any>} worker
 * @param {object} [opts]
 * @param {number} [opts.batchSize]
 * @param {number} [opts.concurrency]
 * @param {number} [opts.cooldownMs]
 * @param {(progress:{done:number,total:number,batch:number,batches:number})=>void} [opts.onProgress]
 * @returns {Promise<Array>} results in input order
 */
export async function runBatched(items, worker, opts = {}) {
  const cfg = { ...BATCH_DEFAULTS, ...opts };
  const batches = chunk(items, cfg.batchSize);
  const all = [];
  let done = 0;

  for (let b = 0; b < batches.length; b++) {
    const offset = b * cfg.batchSize;
    const batchResults = await mapPool(batches[b], cfg.concurrency, async (item, idx) => {
      const r = await worker(item, offset + idx);
      done++;
      if (opts.onProgress) {
        opts.onProgress({ done, total: items.length, batch: b + 1, batches: batches.length });
      }
      return r;
    });
    all.push(...batchResults);

    // Cool down between batches (not after the last one).
    if (b < batches.length - 1 && cfg.cooldownMs > 0) await sleep(cfg.cooldownMs);
  }

  return all;
}
