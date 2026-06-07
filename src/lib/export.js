// Export — the original sheet PLUS appended verdict columns and ONE COLUMN PER
// HOP (CLAUDE.md §7). The column shape MUST match the server CSV builder
// (netlify/functions/lib/report.mjs exportColumns) so XLSX and CSV are identical.
// SheetJS is dynamically imported (lazy chunk).

import { SERVER_LABEL } from './verdict.js';

// Array-of-arrays: header row + data rows. Kept byte-for-byte in sync with the
// server's exportColumns().
export function exportColumns(report) {
  const extraKeys = [];
  for (const r of report.rows) for (const k of Object.keys(r.extra || {})) if (!extraKeys.includes(k)) extraKeys.push(k);
  const maxHops = report.rows.reduce((m, r) => Math.max(m, (r.hops || []).length), 0);
  const hopCols = [];
  for (let i = 1; i <= maxHops; i++) hopCols.push(`Hop ${i} URL`, `Hop ${i} Status`, `Hop ${i} Server`);
  const header = ['Rule Name', 'Source URL', 'Expected Target', ...extraKeys,
    'Actual Target', 'Verdict', 'Hop Count', 'Reason', ...hopCols];
  const body = report.rows.map((r) => {
    const row = [
      r.ruleName, r.source, r.expected || '',
      ...extraKeys.map((k) => (r.extra ? r.extra[k] : '')),
      r.finalUrl || '', r.verdict, r.hopCount, r.reason || '',
    ];
    const hops = r.hops || [];
    for (let i = 0; i < maxHops; i++) {
      const h = hops[i];
      if (h) row.push(h.url || '', h.status != null ? h.status : (h.error || ''), SERVER_LABEL[h.server] || h.server || '');
      else row.push('', '', '');
    }
    return row;
  });
  return [header, ...body];
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportExcel(report) {
  const XLSX = await import('xlsx');
  const aoa = exportColumns(report);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Reasonable widths: URL columns wide, status/server narrower.
  ws['!cols'] = aoa[0].map((h) => ({ wch: /URL|Target/.test(h) ? 40 : /Server|Reason/.test(h) ? 16 : 12 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Audit');
  XLSX.writeFile(wb, `${report.filename || 'audit'}.xlsx`);
}

export function exportJSON(report) {
  download(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }), `${report.filename || 'audit'}.json`);
}
