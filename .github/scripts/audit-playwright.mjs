// Audit engine — Playwright on GitHub Actions (the primary engine; CLAUDE.md
// §2/§3 evolution). Reads the normalised input the Netlify dispatch staged in
// the reports repo, traces EVERY URL in a real browser (WAF-friendly batching),
// classifies with the SAME strict verdict model, and writes the immutable report
// (JSON + CSV) back to the reports repo. No Netlify runtime is used for tracing.

import { chromium } from 'playwright';
import { getJson, putContent, putJson, updateDayIndex } from './lib/reports-repo.mjs';
import { traceBrowser } from './lib/playwright-trace.mjs';
import { rowFromResult, buildReport } from '../../netlify/functions/lib/audit.mjs';
import { toCSV } from '../../netlify/functions/lib/report.mjs';
import { runBatched } from '../../netlify/functions/lib/batch.mjs';

const { INPUT_PATH, REPORT_PATH, REPORT_BASE, REPORTS_TOKEN } = process.env;

if (!REPORTS_TOKEN || !INPUT_PATH || !REPORT_PATH || !REPORT_BASE) {
  console.error('Missing required env (REPORTS_TOKEN/INPUT_PATH/REPORT_PATH/REPORT_BASE).');
  process.exit(1);
}

// Low-concurrency, domain-aware, adaptive batching (CLAUDE.md §3). A real browser
// is heavier than fetch, so keep the global ceiling modest.
const BATCH = {
  batchSize: Number(process.env.BATCH_SIZE) || 30,
  concurrency: Number(process.env.BATCH_CONCURRENCY) || 3,
  cooldownMs: Number(process.env.BATCH_COOLDOWN_MS) || 4000,
  startInFlight: Number(process.env.START_IN_FLIGHT) || 3,
  minInFlight: 1,
  maxInFlight: Number(process.env.MAX_IN_FLIGHT) || 5,
  rampEvery: 10,
  assess: (r) => (r && r.trace && (r.trace.blocked || r.trace.error) ? 'blocked' : 'ok'),
};

const PER_URL_TIMEOUT_MS = Number(process.env.HOP_TIMEOUT_MS) || 45000;

async function run() {
  const input = await getJson(INPUT_PATH);
  const items = Array.isArray(input.items) ? input.items : [];
  console.log(`Auditing ${items.length} URL(s) for ${REPORT_BASE} with Playwright`);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-US',
  });

  let results;
  try {
    results = await runBatched(
      items,
      async (item) => {
        if (!item.source || !/^https?:/i.test(item.source)) {
          return { ...item, trace: { source: item.source, finalUrl: null, finalStatus: null, hopCount: 0, blocked: false, loop: false, error: 'invalid URL — provide a full https:// URL', hops: [] } };
        }
        const trace = await traceBrowser(context, item.source, { timeoutMs: PER_URL_TIMEOUT_MS });
        return { ...item, trace };
      },
      BATCH,
    );
  } finally {
    await browser.close().catch(() => {});
  }

  const rows = results.map((r) => rowFromResult(r)); // deepPending:false — terminal
  const report = buildReport(
    {
      id: input.id, base: REPORT_BASE, createdUtc: input.createdUtc, createdLocal: input.createdLocal,
      user: input.user, role: input.role, engine: 'playwright', mode: input.mode,
      baseUrl: input.baseUrl, mapping: input.mapping, columns: input.columns, status: 'complete',
    },
    rows,
  );

  await putContent(REPORT_PATH, JSON.stringify(report, null, 2), `audit ${REPORT_BASE} (json)`);
  await putContent(REPORT_PATH.replace(/\.json$/, '.csv'), toCSV(report), `audit ${REPORT_BASE} (csv)`);

  // Best-effort history index (never block the audit on an index race).
  const dir = REPORT_PATH.replace(/\/[^/]+$/, '');
  await updateDayIndex(dir, {
    file: REPORT_PATH, name: REPORT_BASE, id: report.id, user: report.user,
    createdUtc: report.createdUtc, summary: report.summary, status: report.status,
  }).catch((e) => console.error('index update skipped:', e.message));

  console.log(`Wrote ${REPORT_PATH} — ${JSON.stringify(report.summary)}`);
}

run().catch(async (e) => {
  console.error(e);
  // Write a terminal error report so the poller doesn't hang forever.
  try {
    await putJson(REPORT_PATH, {
      filename: REPORT_BASE, createdUtc: new Date().toISOString(), status: 'complete',
      engine: 'playwright', error: `audit failed: ${e.message}`,
      summary: { checked: 0, passed: 0, failed: 0, blocked: 0, deepChecked: 0 }, rows: [],
    }, `audit ${REPORT_BASE} (error)`, { overwrite: true });
  } catch (e2) {
    console.error('Could not write error report:', e2.message);
  }
  process.exit(1);
});
