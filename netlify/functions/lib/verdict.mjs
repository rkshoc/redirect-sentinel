// Verdict model — see CLAUDE.md §6.
//
// Match is decided ONLY by final URL vs expected target, STRICT (exact)
// comparison. Status codes and hop count are captured for display but DO NOT
// affect pass/fail. When a FAIL occurs we classify *why* it differs so users
// can separate trivial noise from real bugs.

export const VERDICT = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  BLOCKED: 'BLOCKED',
  INFO: 'INFO', // paste mode: traced, no expected target to compare against
};

export const REASON = {
  TRIVIAL: 'trivial difference',
  REAL: 'real mismatch',
  NO_REDIRECT: 'no redirect',
  BROKEN: 'broken',
  UNREACHABLE: 'unreachable / network error',
  LOOP: 'loop / too many hops',
};

// Normalise a URL for the *trivial-difference* test only. The verdict itself
// stays strict; this is purely to label FAILs. Differences considered trivial:
// trailing slash, case, protocol (http/https), www prefix, query string.
function normaliseTrivial(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    // Not a parseable absolute URL — fall back to a lowercased, slash-trimmed
    // string compare.
    return String(raw).toLowerCase().replace(/\/+$/, '');
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  let path = u.pathname.toLowerCase();
  if (path.length > 1) path = path.replace(/\/+$/, '');
  // protocol and query intentionally dropped for the trivial test
  return `${host}${path}`;
}

/**
 * Decide the verdict for a single audited row.
 *
 * @param {object} input
 * @param {string|null} input.expected   Expected target URL (null/'' in paste mode).
 * @param {string|null} input.finalUrl   Final URL after following redirects.
 * @param {number|null} input.finalStatus Final HTTP status.
 * @param {number}      input.hopCount    Number of hops captured.
 * @param {boolean}     input.blocked     True if a hop was WAF-blocked / inconclusive.
 * @param {boolean}     input.loop        True if a redirect loop / hop cap was hit.
 * @param {object}      [opts]
 * @param {number}      [opts.maxHops=10]
 * @returns {{verdict:string, reason:(string|null)}}
 */
export function classify(input, opts = {}) {
  const { expected, finalUrl, finalStatus, hopCount = 0, blocked = false, loop = false, inconclusive = false, error = null } = input;

  // BLOCKED is not a real result — never a FAIL (CLAUDE.md §6). A WAF block or
  // an inconclusive network failure (timeout / reset / no response) both land
  // here so they don't masquerade as a definitive FAIL and stay eligible for
  // the Playwright fallback.
  if (blocked || inconclusive) return { verdict: VERDICT.BLOCKED, reason: null };

  // A hard, conclusive network failure (e.g. host not found) with no final URL
  // is a real failure, but a *network* one — label it clearly, not "mismatch".
  if (error && finalUrl == null) {
    if (expected == null || String(expected).trim() === '') return { verdict: VERDICT.INFO, reason: null };
    return { verdict: VERDICT.FAIL, reason: REASON.UNREACHABLE };
  }

  // Paste mode: nothing to compare against, just informational trace.
  if (expected == null || String(expected).trim() === '') {
    return { verdict: VERDICT.INFO, reason: null };
  }

  const exp = String(expected).trim();

  // Loop / too many hops short-circuits to FAIL with that reason.
  if (loop) return { verdict: VERDICT.FAIL, reason: REASON.LOOP };

  // STRICT comparison decides PASS/FAIL.
  if (finalUrl != null && finalUrl === exp) {
    return { verdict: VERDICT.PASS, reason: null };
  }

  // It's a FAIL — now classify why, in priority order.

  // Broken: chain ended on a 4xx/5xx.
  if (typeof finalStatus === 'number' && finalStatus >= 400) {
    return { verdict: VERDICT.FAIL, reason: REASON.BROKEN };
  }

  // No redirect: the source returned 200 directly with a single hop — the rule
  // never fired.
  if (hopCount <= 1 && typeof finalStatus === 'number' && finalStatus >= 200 && finalStatus < 300) {
    return { verdict: VERDICT.FAIL, reason: REASON.NO_REDIRECT };
  }

  // Trivial vs real: compare normalised forms.
  if (finalUrl != null && normaliseTrivial(finalUrl) === normaliseTrivial(exp)) {
    return { verdict: VERDICT.FAIL, reason: REASON.TRIVIAL };
  }

  return { verdict: VERDICT.FAIL, reason: REASON.REAL };
}
