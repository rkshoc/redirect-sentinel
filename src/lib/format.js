// Display helpers.

// Mask an email for display: keep the local part (before @), hide the domain
// with "***". Non-email labels (e.g. "anon") are returned unchanged.
export function maskEmail(value) {
  if (!value) return value;
  const s = String(value);
  const at = s.indexOf('@');
  return at === -1 ? s : `${s.slice(0, at)}***`;
}

// Render a UTC ISO timestamp in the VIEWER's local timezone (the browser
// decides the zone). Reports are stored in UTC (source of truth) and shown
// local. `tz` appends the zone name (e.g. GMT+1) for an unambiguous single use.
export function formatLocal(iso, { tz = true } = {}) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const opts = { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  if (tz) opts.timeZoneName = 'short';
  try {
    return new Intl.DateTimeFormat(undefined, opts).format(d);
  } catch {
    return d.toLocaleString();
  }
}
