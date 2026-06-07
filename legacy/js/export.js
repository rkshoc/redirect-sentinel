// Export — the original sheet PLUS appended verdict columns, as Excel or JSON
// (CLAUDE.md §7).

/* global XLSX */

const SERVER_LABEL = { akamai: 'Akamai edge', dispatcher: 'AEM dispatcher', origin: 'AEM publish', unknown: 'origin · masked' };

// Full redirect chain as readable text — every hop, not just first/last.
// One hop per line so the whole chain survives the export.
function hopChainText(hops) {
  if (!hops || !hops.length) return '';
  return hops.map((h, i) => {
    const code = h.status || h.error || 'err';
    const srv = SERVER_LABEL[h.server] || h.server || 'unknown';
    const t = h.timeMs != null ? ` · ${h.timeMs}ms` : '';
    const fin = i === hops.length - 1 ? ' (final)' : '';
    return `#${h.n != null ? h.n : i + 1} ${h.url} [${code} · ${srv}${t}]${fin}`;
  }).join('\n');
}

function appendedRows(report) {
  const extraKeys = [];
  for (const r of report.rows) for (const k of Object.keys(r.extra || {})) if (!extraKeys.includes(k)) extraKeys.push(k);
  const header = ['Rule Name', 'Source URL', 'Expected Target', ...extraKeys,
    'Actual Target', 'Verdict', 'Hop Count', 'Reason', 'Hop Chain'];
  const body = report.rows.map((r) => [
    r.ruleName, r.source, r.expected || '',
    ...extraKeys.map((k) => (r.extra ? r.extra[k] : '')),
    r.finalUrl || '', r.verdict, r.hopCount, r.reason || '', hopChainText(r.hops),
  ]);
  return [header, ...body];
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportExcel(report) {
  const aoa = appendedRows(report);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Widen and wrap the Hop Chain column (last) so the full multi-line chain is legible.
  const last = aoa[0].length - 1;
  ws['!cols'] = aoa[0].map((_, c) => ({ wch: c === last ? 70 : 22 }));
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let r = 1; r <= range.e.r; r++) {
    const cell = ws[XLSX.utils.encode_cell({ r, c: last })];
    if (cell) cell.s = { alignment: { wrapText: true, vertical: 'top' } };
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Audit');
  XLSX.writeFile(wb, `${report.filename || 'audit'}.xlsx`);
}

export function exportJSON(report) {
  download(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }), `${report.filename || 'audit'}.json`);
}
