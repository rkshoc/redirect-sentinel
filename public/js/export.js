// Export — the original sheet PLUS appended verdict columns, as Excel or JSON
// (CLAUDE.md §7).

/* global XLSX */

function appendedRows(report) {
  const extraKeys = [];
  for (const r of report.rows) for (const k of Object.keys(r.extra || {})) if (!extraKeys.includes(k)) extraKeys.push(k);
  const header = ['Rule Name', 'Source URL', 'Expected Target', ...extraKeys,
    'Actual Target', 'Verdict', 'Hop Count', 'Reason'];
  const body = report.rows.map((r) => [
    r.ruleName, r.source, r.expected || '',
    ...extraKeys.map((k) => (r.extra ? r.extra[k] : '')),
    r.finalUrl || '', r.verdict, r.hopCount, r.reason || '',
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
  const ws = XLSX.utils.aoa_to_sheet(appendedRows(report));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Audit');
  XLSX.writeFile(wb, `${report.filename || 'audit'}.xlsx`);
}

export function exportJSON(report) {
  download(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }), `${report.filename || 'audit'}.json`);
}
