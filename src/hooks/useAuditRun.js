import { useCallback, useEffect, useRef, useState } from 'react';
import { ANON_LIMIT } from '../context/AuthContext.jsx';
import { auditableRows, parsePaste } from '../lib/parse.js';
import { predictPath, shortId } from '../lib/path.js';
import { postAudit, getReport, whoami } from '../lib/api.js';

const fmtTime = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const IDLE = { show: false, phase: '', total: 0, batches: 0, fillPct: 0, elapsed: '0:00', eta: '—' };

/**
 * Encapsulates runAudit + pollReport + progress (ported from legacy app.js).
 * Timers + the poll loop are held in refs and torn down on unmount, with an
 * AbortController — fixes the legacy bug where navigating away left the poll
 * `while` loop running.
 */
export function useAuditRun({ onReport }) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(IDLE);

  const progTimer = useRef(null);
  const cancelled = useRef(false);
  const abort = useRef(null);

  const stopProgress = useCallback(() => {
    if (progTimer.current) clearInterval(progTimer.current);
    progTimer.current = null;
    setProgress(IDLE);
  }, []);

  const finishProgress = useCallback(() => {
    if (progTimer.current) clearInterval(progTimer.current);
    progTimer.current = null;
    setProgress((p) => ({ ...p, fillPct: 100 }));
    setTimeout(() => setProgress(IDLE), 800);
  }, []);

  // Cleanup on unmount: stop the loop + timer + any in-flight fetch.
  useEffect(() => () => {
    cancelled.current = true;
    if (progTimer.current) clearInterval(progTimer.current);
    if (abort.current) abort.current.abort();
  }, []);

  const startProgress = useCallback((n) => {
    const batches = Math.ceil(n / 30);
    const estMs = 6000 /* cold start */ + batches * 4000 /* cooldowns */ + n * 700; /* per-URL */
    const start = Date.now();
    setProgress({ show: true, phase: 'Tracing redirects via HTTP…', total: n, batches, fillPct: 0, elapsed: '0:00', eta: fmtTime(estMs) });
    progTimer.current = setInterval(() => {
      const elapsed = Date.now() - start;
      setProgress((p) => ({
        ...p,
        elapsed: fmtTime(elapsed),
        eta: elapsed >= estMs ? 'wrapping up' : fmtTime(estMs - elapsed),
        fillPct: Math.min(95, (elapsed / estMs) * 95),
      }));
    }, 300);
  }, []);

  const pollReport = useCallback(async (path) => {
    const deadline = Date.now() + 14 * 60 * 1000; // background fn max ~15 min
    // While the background job runs, /api/report returns 404 by design ("not
    // written yet"). Back the poll interval off (2.5s → 6s) so a long job makes
    // far fewer requests instead of hammering every 3s.
    let polls = 0;
    let partial = false;
    while (Date.now() < deadline && !cancelled.current) {
      const interval = partial ? 12000 : Math.min(6000, 2500 + polls * 750);
      await new Promise((r) => setTimeout(r, interval));
      polls++;
      if (cancelled.current) return;
      let data;
      try {
        const res = await getReport(path);
        if (res.status === 404) continue; // still running
        data = await res.json();
        if (res.status >= 500) { stopProgress(); setRunning(false); setError(data.error || `Server error (HTTP ${res.status}).`); return; }
      } catch { continue; }

      if (data && data.error && !data.rows) { stopProgress(); setRunning(false); setError(data.error); return; }
      if (data && data.rows) {
        if (data.status === 'partial') {
          onReport(data); // live-refresh while deep-checks run
          partial = true;
          continue;
        }
        finishProgress();
        setRunning(false);
        onReport(data);
        return;
      }
    }
    if (!cancelled.current) { setRunning(false); stopProgress(); setError('Audit timed out waiting for results. Check the History tab shortly.'); }
  }, [onReport, stopProgress, finishProgress]);

  const run = useCallback(async ({ sheet, mapping, pasteText, user, limit }) => {
    setError('');
    const count = sheet ? auditableRows(sheet, mapping).length : parsePaste(pasteText).length;
    if (!count) { setError('Upload a sheet or paste URLs to begin.'); return; }
    if (count > limit) { setError(`${count} URLs exceeds your limit of ${limit === Infinity ? '∞' : limit}.`); return; }
    if (!user && count > ANON_LIMIT) { setError(`Log in to audit more than ${ANON_LIMIT} URLs.`); return; }

    cancelled.current = false;
    setRunning(true);
    startProgress(count);

    const { token, userLabel } = await whoami(user);
    const id = shortId();
    const now = new Date();
    const path = predictPath(now, userLabel, id);
    let payload;
    if (sheet && sheet.rows.length) {
      if (mapping.source == null) { stopProgress(); setRunning(false); setError('Map a Source URL column before running.'); return; }
      const rows = auditableRows(sheet, mapping);
      if (!rows.length) { stopProgress(); setRunning(false); setError('No rows have both a Source and Expected URL. Check your column mapping.'); return; }
      payload = { mode: 'sheet', columns: sheet.columns, mapping, rows, id, timestamp: now.toISOString() };
    } else {
      const urls = parsePaste(pasteText);
      if (!urls.length) { stopProgress(); setRunning(false); setError('Paste at least one URL, or upload a sheet.'); return; }
      payload = { mode: 'paste', urls, id, timestamp: now.toISOString() };
    }
    if (token) payload._auth = token;

    let res;
    try {
      res = await postAudit(payload);
    } catch (e) {
      stopProgress(); setRunning(false); setError(`Network error: ${e.message}`); return;
    }
    // 202 = accepted (background started); 4xx (not 404) = synchronous rejection.
    if (res.status >= 400 && res.status !== 404) {
      stopProgress(); setRunning(false);
      setError((await res.json().catch(() => ({}))).error || `Request rejected (HTTP ${res.status}).`);
      return;
    }
    pollReport(path);
  }, [startProgress, stopProgress, pollReport]);

  return { run, running, progress, error, clearError: () => setError('') };
}
