import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toItems, summarize, formatText, endpointUrl, runCheck, PER_CALL } from './lib.mjs';

test('endpointUrl appends /api/check and requires a base', () => {
  assert.equal(endpointUrl('https://x.netlify.app'), 'https://x.netlify.app/api/check');
  assert.equal(endpointUrl('https://x.netlify.app/'), 'https://x.netlify.app/api/check');
  assert.throws(() => endpointUrl(''), /REDIRECT_SENTINEL_URL/);
});

test('toItems accepts urls or items shapes', () => {
  assert.deepEqual(toItems({ urls: ['https://a', ' '] }), [{ source: 'https://a' }]);
  assert.deepEqual(
    toItems({ items: [{ source: 'https://a', expected: 'https://b', ruleName: 'R' }] }),
    [{ source: 'https://a', expected: 'https://b', ruleName: 'R' }],
  );
});

test('runCheck chunks into PER_CALL-sized POSTs and aggregates results', async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body.items.length);
    return {
      ok: true,
      json: async () => ({ results: body.items.map((it) => ({ source: it.source, verdict: 'PASS', finalUrl: it.source, finalStatus: 200 })) }),
    };
  };
  const urls = Array.from({ length: 23 }, (_, i) => `https://x/${i}`);
  const out = await runCheck({ baseUrl: 'https://x', urls, fetchImpl: fakeFetch, delayMs: 0 });
  assert.deepEqual(calls, [PER_CALL, PER_CALL, 3]); // 23 -> 10 + 10 + 3
  assert.equal(out.results.length, 23);
  assert.equal(out.summary.passed, 23);
});

test('runCheck rejects over the hard ceiling and empty input', async () => {
  const urls = Array.from({ length: 51 }, (_, i) => `https://x/${i}`);
  await assert.rejects(runCheck({ baseUrl: 'https://x', urls, fetchImpl: async () => ({}) }), /Too many URLs/);
  await assert.rejects(runCheck({ baseUrl: 'https://x', urls: [], fetchImpl: async () => ({}) }), /Provide/);
});

test('runCheck surfaces a non-OK endpoint response', async () => {
  const fakeFetch = async () => ({ ok: false, status: 413, text: async () => 'capped' });
  await assert.rejects(runCheck({ baseUrl: 'https://x', urls: ['https://a'], fetchImpl: fakeFetch }), /413: capped/);
});

test('formatText renders a summary + per-row lines', () => {
  const text = formatText({ summary: summarize([{ verdict: 'FAIL', reason: 'real mismatch' }]), results: [
    { verdict: 'FAIL', reason: 'real mismatch', source: 'https://a', finalUrl: 'https://c', finalStatus: 200, expected: 'https://b' },
  ] });
  assert.match(text, /1 pass.*|0 pass, 1 fail/);
  assert.match(text, /FAIL \(real mismatch\) — https:\/\/a → https:\/\/c \[200\]/);
});
