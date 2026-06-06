import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classify, VERDICT, REASON } from '../netlify/functions/lib/verdict.mjs';
import { tagServer, SERVER } from '../netlify/functions/lib/servertag.mjs';
import { archivePaths, toCSV, summarise } from '../netlify/functions/lib/report.mjs';
import { chunk, runBatched } from '../netlify/functions/lib/batch.mjs';
import { resolveIdentity, checkLimit, ROLE_LIMITS, ANON_LIMIT, signIdentity, verifyIdentity } from '../netlify/functions/lib/auth.mjs';

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
test('CSV appends verdict columns and carries extras', () => {
  const report = { rows: [
    { ruleName: 'R1', source: '/a', expected: '/b', extra: { Notes: 'hi, there' }, finalUrl: '/b', verdict: 'PASS', hopCount: 2, reason: null,
      hops: [
        { n: 1, url: '/a', status: 301, server: 'akamai', timeMs: 12 },
        { n: 2, url: '/b', status: 200, server: 'origin', timeMs: 30 },
      ] },
  ] };
  const csv = toCSV(report);
  const [header, row] = csv.split('\r\n');
  assert.equal(header, 'Rule Name,Source URL,Expected Target,Notes,Actual Target,Verdict,Hop Count,Reason,Hop Chain');
  assert.ok(row.includes('"hi, there"')); // escaped comma
  // Full chain exported — every hop, not just first/last.
  assert.ok(row.includes('#1 /a [301 · Akamai edge · 12ms]'));
  assert.ok(row.includes('#2 /b [200 · AEM publish · 30ms] (final)'));
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
