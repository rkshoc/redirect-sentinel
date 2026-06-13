import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classify, VERDICT, REASON } from '../netlify/functions/lib/verdict.mjs';
import { tagServer, SERVER } from '../netlify/functions/lib/servertag.mjs';
import { archivePaths, toCSV, summarise } from '../netlify/functions/lib/report.mjs';
import { chunk, runBatched, registrableDomain } from '../netlify/functions/lib/batch.mjs';
import { sanitizeUrl, classifyFetchError } from '../netlify/functions/lib/engine.mjs';
import { explainDispatchFailure, help404, resolveDispatchRef } from '../netlify/functions/lib/github.mjs';
import { buildItems, runChecks, formatResults, MAX } from '../netlify/functions/lib/check-core.mjs';
import { resolveIdentity, checkLimit, ROLE_LIMITS, ANON_LIMIT, signIdentity, verifyIdentity } from '../netlify/functions/lib/auth.mjs';
import { mergeDeepCheck } from '../netlify/functions/get-report.mjs';

process.env.INTERNAL_TOKEN = 'test-signing-secret';

// ---------- verdict ----------
test('PASS on exact match', () => {
  const r = classify({ expected: 'https://x.com/a', finalUrl: 'https://x.com/a', finalStatus: 200, hopCount: 2 });
  assert.equal(r.verdict, VERDICT.PASS);
});

test('strict: trailing slash is a FAIL classified trivial', () => {
  const r = classify({ expected: 'https://x.com/cart', finalUrl: 'https://x.com/cart/', finalStatus: 200, hopCount: 2 });
  assert.equal(r.verdict, VERDICT.FAIL);
  assert.equal(r.reason, REASON.TRIVIAL);
});

test('case/www/protocol differences are trivial', () => {
  const r = classify({ expected: 'https://www.x.com/A', finalUrl: 'http://x.com/a', finalStatus: 200, hopCount: 2 });
  assert.equal(r.reason, REASON.TRIVIAL);
});

test('genuinely different path is a real mismatch', () => {
  const r = classify({ expected: 'https://x.com/us/en/products', finalUrl: 'https://x.com/products', finalStatus: 200, hopCount: 3 });
  assert.equal(r.reason, REASON.REAL);
});

test('broken final status', () => {
  const r = classify({ expected: 'https://x.com/support', finalUrl: 'https://x.com/support', finalStatus: 404, hopCount: 2 });
  // Note: finalUrl equals expected but status 404 -> still PASS by strict URL rule?
  // No: strict compares URL only; URL matches => PASS. Status is info only.
  assert.equal(r.verdict, VERDICT.PASS);
});

test('broken when URL differs and final is 4xx', () => {
  const r = classify({ expected: 'https://x.com/support', finalUrl: 'https://x.com/help', finalStatus: 404, hopCount: 2 });
  assert.equal(r.verdict, VERDICT.FAIL);
  assert.equal(r.reason, REASON.BROKEN);
});

test('no redirect: single 200 hop, url differs', () => {
  const r = classify({ expected: 'https://x.com/new', finalUrl: 'https://x.com/old', finalStatus: 200, hopCount: 1 });
  assert.equal(r.reason, REASON.NO_REDIRECT);
});

test('blocked is never a fail', () => {
  const r = classify({ expected: 'https://x.com/a', finalUrl: null, finalStatus: 403, hopCount: 1, blocked: true });
  assert.equal(r.verdict, VERDICT.BLOCKED);
});

test('loop / too many hops', () => {
  const r = classify({ expected: 'https://x.com/a', finalUrl: 'https://x.com/b', finalStatus: 301, hopCount: 10, loop: true });
  assert.equal(r.reason, REASON.LOOP);
});

test('paste mode (no expected) is INFO', () => {
  const r = classify({ expected: null, finalUrl: 'https://x.com/a', finalStatus: 200, hopCount: 1 });
  assert.equal(r.verdict, VERDICT.INFO);
});

// ---------- server tag ----------
test('akamai edge by Server header', () => {
  assert.equal(tagServer({ Server: 'AkamaiGHost' }), SERVER.AKAMAI);
});
test('akamai by x-akamai prefix', () => {
  assert.equal(tagServer({ 'X-Akamai-Transformed': '9' }), SERVER.AKAMAI);
});
test('dispatcher by x-dispatcher', () => {
  assert.equal(tagServer({ 'X-Dispatcher': 'dispatcher1', Server: 'Apache' }), SERVER.DISPATCHER);
});
test('origin by sling header', () => {
  assert.equal(tagServer({ Server: 'Day-Communique/5.5' }), SERVER.ORIGIN);
});
test('unknown when masked', () => {
  assert.equal(tagServer({ Server: 'cloudfront', 'Content-Type': 'text/html' }), SERVER.UNKNOWN);
});

// ---------- report paths ----------
test('archive path is UTC date-foldered with shortid', () => {
  const d = new Date('2026-06-04T16:20:00Z');
  const p = archivePaths(d, 'admin', 'a3f9');
  assert.equal(p.json, '2026/06/04/audit_2026-06-04T1620Z_admin_a3f9.json');
  assert.equal(p.csv, '2026/06/04/audit_2026-06-04T1620Z_admin_a3f9.csv');
});

test('user label is sanitised in filename', () => {
  const d = new Date('2026-06-04T16:20:00Z');
  const p = archivePaths(d, 'R.Bind@House.com', 'zz00');
  assert.match(p.base, /^audit_2026-06-04T1620Z_r\.bind-house\.com_zz00$/);
});

// ---------- CSV export ----------
test('CSV appends verdict columns, carries extras, one column per hop', () => {
  const report = { rows: [
    { ruleName: 'R1', source: '/a', expected: '/b', extra: { Notes: 'hi, there' }, finalUrl: '/b', verdict: 'PASS', hopCount: 2, reason: null,
      hops: [
        { n: 1, url: '/a', status: 301, server: 'akamai', timeMs: 12 },
        { n: 2, url: '/b', status: 200, server: 'origin', timeMs: 30 },
      ] },
  ] };
  const csv = toCSV(report);
  const [header, row] = csv.split('\r\n');
  // Per-hop columns up to the longest chain (here 2 hops).
  assert.equal(header, 'Rule Name,Source URL,Expected Target,Notes,Actual Target,Verdict,Hop Count,Reason,Hop 1 URL,Hop 1 Status,Hop 1 Server,Hop 2 URL,Hop 2 Status,Hop 2 Server');
  assert.ok(row.includes('"hi, there"')); // escaped comma
  // Every hop broken into its own URL/Status/Server cells.
  assert.equal(row, 'R1,/a,/b,"hi, there",/b,PASS,2,,/a,301,Akamai edge,/b,200,AEM publish');
});

test('CSV pads shorter chains and widens to the longest', () => {
  const report = { rows: [
    { ruleName: 'short', source: '/s', expected: '/s', finalUrl: '/s', verdict: 'FAIL', hopCount: 1, reason: 'no redirect',
      hops: [{ n: 1, url: '/s', status: 200, server: 'unknown', timeMs: 5 }] },
    { ruleName: 'long', source: '/a', expected: '/c', finalUrl: '/c', verdict: 'PASS', hopCount: 3, reason: null,
      hops: [
        { n: 1, url: '/a', status: 301, server: 'akamai', timeMs: 1 },
        { n: 2, url: '/b', status: 302, server: 'dispatcher', timeMs: 2 },
        { n: 3, url: '/c', status: 200, server: 'origin', timeMs: 3 },
      ] },
  ] };
  const [header, r1] = toCSV(report).split('\r\n');
  assert.ok(header.endsWith('Hop 1 URL,Hop 1 Status,Hop 1 Server,Hop 2 URL,Hop 2 Status,Hop 2 Server,Hop 3 URL,Hop 3 Status,Hop 3 Server'));
  // The 1-hop row has blank cells for hops 2 and 3 (6 trailing empty fields).
  assert.equal(r1, 'short,/s,/s,/s,FAIL,1,no redirect,/s,200,origin · masked,,,,,,');
});

// ---------- summary ----------
test('summarise counts verdicts + deep checks', () => {
  const s = summarise([
    { verdict: 'PASS' }, { verdict: 'FAIL' }, { verdict: 'FAIL' },
    { verdict: 'BLOCKED' }, { verdict: 'PASS', deepChecked: true },
  ]);
  assert.deepEqual(s, { checked: 5, passed: 2, failed: 2, blocked: 1, deepChecked: 1 });
});

// ---------- batching ----------
test('chunk splits correctly', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test('runBatched preserves order and processes all', async () => {
  const items = Array.from({ length: 7 }, (_, i) => i);
  const out = await runBatched(items, async (x) => x * 2, { batchSize: 3, concurrency: 2, cooldownMs: 0 });
  assert.deepEqual(out, [0, 2, 4, 6, 8, 10, 12]);
});

test('runBatched caps concurrency PER DOMAIN but parallelises ACROSS domains', async () => {
  // 4 domains x 5 URLs each. Per-domain concurrency 2; global cap 8.
  const items = [];
  for (let d = 0; d < 4; d++) for (let u = 0; u < 5; u++) items.push({ source: `https://site${d}.com/p${u}` });
  const perDomain = {}; // peak in-flight per registrable domain
  let inFlight = 0, peakGlobal = 0;
  const out = await runBatched(items, async (item) => {
    const host = new URL(item.source).hostname;
    perDomain[host] = (perDomain[host] || 0);
    perDomain[host]++; inFlight++;
    peakGlobal = Math.max(peakGlobal, inFlight);
    perDomain[`peak_${host}`] = Math.max(perDomain[`peak_${host}`] || 0, perDomain[host]);
    await new Promise((r) => setTimeout(r, 5));
    perDomain[host]--; inFlight--;
    return item.source;
  }, { batchSize: 30, concurrency: 2, cooldownMs: 0, maxInFlight: 8 });

  assert.equal(out.length, 20);
  for (let d = 0; d < 4; d++) {
    assert.ok(perDomain[`peak_site${d}.com`] <= 2, `site${d} exceeded per-domain concurrency`);
  }
  assert.ok(peakGlobal > 2, 'mixed domains should run more in parallel than a single domain would');
  assert.ok(peakGlobal <= 8, 'global in-flight must respect maxInFlight');
});

test('registrableDomain groups subdomains and handles two-level TLDs', () => {
  assert.equal(registrableDomain('www.brand.com'), 'brand.com');
  assert.equal(registrableDomain('shop.brand.com'), 'brand.com');
  assert.equal(registrableDomain('www.brand.co.uk'), 'brand.co.uk');
  assert.equal(registrableDomain('brand.com'), 'brand.com');
});

test('runBatched backs off global concurrency under a throttle signal', async () => {
  // The worker reports "blocked" whenever more than 3 requests are in flight —
  // a stand-in for an IP/volume throttle. AIMD must drive concurrency down so
  // that, after adapting, peak in-flight settles at/under the tolerated level.
  const items = Array.from({ length: 120 }, (_, i) => ({ source: `https://h${i % 12}.com/p${i}` }));
  let inFlight = 0;
  const peaksOverTime = [];
  const out = await runBatched(items, async () => {
    inFlight++;
    const breached = inFlight > 3;
    peaksOverTime.push(inFlight);
    await new Promise((r) => setTimeout(r, 3));
    inFlight--;
    return { trace: { blocked: breached, inconclusive: false } };
  }, {
    concurrency: 4, batchSize: 999, cooldownMs: 5,
    startInFlight: 10, minInFlight: 1, maxInFlight: 10, rampEvery: 1000,
    assess: (r) => (r.trace.blocked || r.trace.inconclusive ? 'blocked' : 'ok'),
  });
  assert.equal(out.length, 120);
  // Early it overshoots (started at 10); the tail must have calmed right down.
  const tail = peaksOverTime.slice(-30);
  const tailMax = Math.max(...tail);
  assert.ok(tailMax <= 4, `expected back-off to settle concurrency (tail peak ${tailMax})`);
});

test('sanitizeUrl strips wrapping quotes, whitespace and hidden chars', () => {
  assert.equal(sanitizeUrl('  https://x.com/a  '), 'https://x.com/a');
  assert.equal(sanitizeUrl('"https://x.com/a"'), 'https://x.com/a');
  assert.equal(sanitizeUrl('﻿https://x.com/a'), 'https://x.com/a');
  assert.equal(sanitizeUrl('https://x.com/a​'), 'https://x.com/a');
});

test('classifyFetchError marks transient failures inconclusive, NXDOMAIN hard', () => {
  assert.deepEqual(classifyFetchError({ name: 'AbortError' }), { kind: 'timeout', inconclusive: true });
  assert.equal(classifyFetchError({ cause: { code: 'ECONNRESET' } }).inconclusive, true);
  assert.equal(classifyFetchError({ message: 'fetch failed' }).inconclusive, true);
  assert.equal(classifyFetchError({ cause: { code: 'ENOTFOUND' } }).inconclusive, false);
  assert.equal(classifyFetchError({ cause: { code: 'ENOTFOUND' } }).kind, 'host not found');
});

test('classify: inconclusive network failure is BLOCKED, hard failure is UNREACHABLE', () => {
  const blocked = classify({ expected: 'https://x.com/a', finalUrl: null, finalStatus: null, hopCount: 1, inconclusive: true, error: 'timeout' });
  assert.equal(blocked.verdict, VERDICT.BLOCKED);
  const unreachable = classify({ expected: 'https://x.com/a', finalUrl: null, finalStatus: null, hopCount: 1, inconclusive: false, error: 'host not found' });
  assert.equal(unreachable.verdict, VERDICT.FAIL);
  assert.equal(unreachable.reason, REASON.UNREACHABLE);
});

test('check-core: buildItems handles urls and items, runChecks enforces the cap', async () => {
  assert.deepEqual(buildItems({ urls: ['https://a.com/x', ' '] }).map((i) => i.source), ['https://a.com/x']);
  assert.equal(buildItems({ items: [{ source: 'https://a.com/x', expected: 'https://b.com/y' }] })[0].expected, 'https://b.com/y');
  const tooMany = { urls: Array.from({ length: MAX + 1 }, (_, i) => `https://x/${i}`) };
  await assert.rejects(runChecks(tooMany), /Capped at/);
  await assert.rejects(runChecks({ urls: [] }), /Provide/);
});

test('runChecks honours an overall deadline (unfinished URLs come back inconclusive)', async () => {
  // Point at a non-routable address so connects hang; a tiny deadline must make
  // the whole call return promptly with BLOCKED/inconclusive rows, not hang.
  const t0 = Date.now();
  const out = await runChecks({ urls: ['http://10.255.255.1/a', 'http://10.255.255.1/b'] }, { deadlineMs: 300 });
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 4000, `expected prompt return, took ${elapsed}ms`);
  assert.equal(out.results.length, 2);
  assert.ok(out.results.every((r) => r.verdict === 'BLOCKED'), 'unfinished rows should be BLOCKED/inconclusive');
});

test('explainDispatchFailure gives actionable messages per status', async () => {
  const cfg = { appOwner: 'me', appRepo: 'app', workflowFile: 'deep-check.yml', appBranch: 'main' };
  assert.match(await explainDispatchFailure(cfg, 403, ''), /lacks the "workflow" scope/);
  assert.match(await explainDispatchFailure(cfg, 422, ''), /APP_BRANCH|workflow_dispatch trigger/);
  assert.match(await explainDispatchFailure(cfg, 500, 'boom'), /GitHub dispatch failed: 500 boom/);
});

test('help404 explains the unregistered-workflow case incl. the fresh-commit nuance', () => {
  const base = { owner: 'me', repo: 'app', workflowFile: 'deep-check.yml', defaultBranch: 'main' };
  // 0 registered → the file may be present but was never registered; enabling
  // Actions alone won't fix it — a fresh commit on the default branch is needed.
  const none = help404({ ...base, registered: 0 });
  assert.match(none, /no registered workflows/i);
  assert.match(none, /does NOT retroactively register/);
  assert.match(none, /fresh commit/);
  assert.match(none, /"main"/); // names the actual default branch
  // >0 but ours absent → wrong filename / not on default branch.
  const some = help404({ ...base, registered: 3 });
  assert.match(some, /not among the 3 registered/);
  // unknown count → generic guidance.
  assert.match(help404({ ...base, registered: null }), /dispatch 404/);
  // null default branch degrades to a readable phrase, not "null".
  assert.match(help404({ ...base, defaultBranch: null, registered: 0 }), /the repo DEFAULT branch/);
  assert.doesNotMatch(help404({ ...base, defaultBranch: null, registered: 0 }), /"null"/);
});

test('resolveDispatchRef prefers an explicit APP_BRANCH (no network)', async () => {
  assert.equal(await resolveDispatchRef({ appBranch: 'release' }), 'release');
  // No appBranch + no token → default-branch lookup is skipped, falls back to main.
  assert.equal(await resolveDispatchRef({ appBranch: null, token: '', appOwner: '' }), 'main');
});

test('formatResults can append the per-hop chain', () => {
  const text = formatResults({
    summary: { checked: 1, passed: 1, failed: 0, blocked: 0 },
    results: [{ verdict: 'PASS', source: 'https://a', finalUrl: 'https://b', finalStatus: 200, hops: [
      { url: 'https://a', status: 301, server: 'akamai', location: 'https://b', timeMs: 12 },
      { url: 'https://b', status: 200, server: 'origin', location: null, timeMs: 5 },
    ] }],
  }, { hops: true });
  assert.match(text, /301  https:\/\/a → https:\/\/b  \(akamai, 12ms\)/);
  assert.match(text, /200  https:\/\/b  \(origin, 5ms\)/);
});

// ---------- deep-check merge ----------
const blockedReport = () => ({
  status: 'partial',
  deepCheck: { pending: 2, companion: 'x.deepcheck.json' },
  rows: [
    { source: 'https://a/1', verdict: 'BLOCKED', deepPending: true },
    { source: 'https://a/2', verdict: 'BLOCKED', deepPending: true },
    { source: 'https://a/3', verdict: 'PASS', deepPending: false },
  ],
});

test('mergeDeepCheck applies all results and completes the report', () => {
  const r = mergeDeepCheck(blockedReport(), { results: [
    { source: 'https://a/1', finalUrl: 'https://a/1x', finalStatus: 200, hopCount: 2, verdict: 'PASS', reason: null, hops: [] },
    { source: 'https://a/2', finalUrl: 'https://a/2x', finalStatus: 200, hopCount: 2, verdict: 'FAIL', reason: 'real mismatch', hops: [] },
  ] });
  assert.equal(r.status, 'complete');
  assert.equal(r.deepCheck.pending, 0);
  assert.ok(r.rows[0].deepChecked && !r.rows[0].deepPending);
  assert.equal(r.rows[0].verdict, 'PASS');
  assert.equal(r.rows[1].verdict, 'FAIL');
});

test('mergeDeepCheck keeps unresolved rows pending when there is no error', () => {
  const r = mergeDeepCheck(blockedReport(), { results: [
    { source: 'https://a/1', finalUrl: 'https://a/1x', finalStatus: 200, hopCount: 2, verdict: 'PASS', reason: null, hops: [] },
  ] });
  assert.equal(r.status, 'partial');
  assert.equal(r.deepCheck.pending, 1);
  assert.equal(r.rows[1].deepPending, true);
});

test('mergeDeepCheck terminalises leftover rows when the run errored (no 14-min spin)', () => {
  // Partial results + an error: the matched row resolves, the unmatched one
  // stops waiting and stays BLOCKED (never a FAIL).
  const r = mergeDeepCheck(blockedReport(), {
    error: 'workflow crashed mid-run',
    results: [{ source: 'https://a/1', finalUrl: 'https://a/1x', finalStatus: 200, hopCount: 2, verdict: 'PASS', reason: null, hops: [] }],
  });
  assert.equal(r.status, 'complete');
  assert.equal(r.deepCheck.pending, 0);
  assert.equal(r.deepCheck.error, 'workflow crashed mid-run');
  assert.equal(r.rows[1].deepPending, false);
  assert.equal(r.rows[1].verdict, 'BLOCKED'); // not flipped to a failure
});

test('mergeDeepCheck terminalises everything on an error with no results', () => {
  const r = mergeDeepCheck(blockedReport(), { error: 'deep-check could not be started', results: [] });
  assert.equal(r.status, 'complete');
  assert.equal(r.deepCheck.pending, 0);
  assert.ok(r.rows.every((row) => !row.deepPending));
  assert.equal(r.rows[0].verdict, 'BLOCKED');
});

// ---------- auth ----------
test('anonymous limit is 10', () => {
  const id = resolveIdentity(undefined);
  assert.equal(id.limit, ANON_LIMIT);
  assert.equal(checkLimit(11, id).status, 401);
  assert.equal(checkLimit(10, id), null);
});

test('roles map to limits, highest wins', () => {
  const id = resolveIdentity({ user: { email: 'a@b.c', app_metadata: { roles: ['basic', 'admin'] } } });
  assert.equal(id.role, 'admin');
  assert.equal(id.limit, ROLE_LIMITS.admin);
  assert.equal(checkLimit(100, id), null);
  assert.equal(checkLimit(101, id).status, 403);
});

test('owner is unlimited', () => {
  const id = resolveIdentity({ user: { email: 'me@x.com', app_metadata: { roles: ['owner'] } } });
  assert.equal(id.limit, Infinity);
  assert.equal(checkLimit(99999, id), null);
});

test('logged-in no role defaults to basic', () => {
  const id = resolveIdentity({ user: { email: 'a@b.c', app_metadata: {} } });
  assert.equal(id.limit, ROLE_LIMITS.basic);
});

// ---------- signed identity ----------
test('signIdentity / verifyIdentity round-trips a logged-in identity', () => {
  const id = resolveIdentity({ user: { email: 'me@x.com', app_metadata: { roles: ['admin'] } } });
  const token = signIdentity(id);
  assert.ok(token && token.includes('.'));
  const back = verifyIdentity(token);
  assert.equal(back.user, 'me@x.com');
  assert.equal(back.role, 'admin');
  assert.equal(back.limit, ROLE_LIMITS.admin);
  assert.equal(back.loggedIn, true);
});

test('owner unlimited survives sign/verify (Infinity <-> inf)', () => {
  const id = resolveIdentity({ user: { email: 'o@x.com', app_metadata: { roles: ['owner'] } } });
  assert.equal(verifyIdentity(signIdentity(id)).limit, Infinity);
});

test('anonymous identity is not signable', () => {
  assert.equal(signIdentity(resolveIdentity(undefined)), null);
});

test('tampered or garbage token fails verification', () => {
  const id = resolveIdentity({ user: { email: 'me@x.com', app_metadata: { roles: ['owner'] } } });
  const token = signIdentity(id);
  assert.equal(verifyIdentity(token.slice(0, -3) + 'xxx'), null); // bad signature
  assert.equal(verifyIdentity('not-a-token'), null);
  assert.equal(verifyIdentity(null), null);
});

test('expired token fails verification', () => {
  const id = resolveIdentity({ user: { email: 'me@x.com', app_metadata: { roles: ['admin'] } } });
  const token = signIdentity(id, -1); // already expired
  assert.equal(verifyIdentity(token), null);
});
