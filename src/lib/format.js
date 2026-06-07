// Display helpers.

// Mask an email for display: keep the local part (before @), hide the domain
// with "***". Non-email labels (e.g. "anon") are returned unchanged.
export function maskEmail(value) {
  if (!value) return value;
  const s = String(value);
  const at = s.indexOf('@');
  return at === -1 ? s : `${s.slice(0, at)}***`;
}
