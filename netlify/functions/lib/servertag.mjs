// Per-hop server/edge fingerprinting — see CLAUDE.md §6.
//
// Classify each hop as one of: 'akamai' (Akamai edge), 'dispatcher'
// (AEM dispatcher), 'origin' (AEM publish / origin), or 'unknown'.
//
// This is best-effort header fingerprinting. The CDN frequently masks the
// origin; when nothing matches we honestly return 'unknown' rather than guess.

export const SERVER = {
  AKAMAI: 'akamai',
  DISPATCHER: 'dispatcher',
  ORIGIN: 'origin',
  UNKNOWN: 'unknown',
};

export const SERVER_LABEL = {
  akamai: 'Akamai edge',
  dispatcher: 'AEM dispatcher',
  origin: 'AEM publish',
  unknown: 'unknown',
};

// `headers` may be a Headers instance or a plain object. Normalise to a
// lowercase-keyed plain object for matching.
function lower(headers) {
  const out = {};
  if (!headers) return out;
  if (typeof headers.forEach === 'function' && !Array.isArray(headers)) {
    headers.forEach((v, k) => { out[String(k).toLowerCase()] = String(v); });
  } else {
    for (const [k, v] of Object.entries(headers)) out[String(k).toLowerCase()] = String(v);
  }
  return out;
}

function has(h, name) {
  return Object.prototype.hasOwnProperty.call(h, name) && h[name] !== '';
}
function hasPrefix(h, prefix) {
  return Object.keys(h).some((k) => k.startsWith(prefix));
}

/**
 * @param {Headers|Object} headers Response headers for this hop.
 * @returns {string} one of SERVER.*
 */
export function tagServer(headers) {
  const h = lower(headers);
  const server = (h['server'] || '').toLowerCase();
  const via = (h['via'] || '').toLowerCase();
  const xCache = (h['x-cache'] || '').toLowerCase();

  // Akamai edge — the responding server is the edge. Definitive signals first.
  if (
    server.includes('akamaighost') ||
    hasPrefix(h, 'x-akamai-') ||
    via.includes('akamai') ||
    /akamai|tcp_|akamaighost/.test(xCache)
  ) {
    return SERVER.AKAMAI;
  }

  // AEM dispatcher — Apache + dispatcher module signals.
  if (
    has(h, 'x-dispatcher') ||
    has(h, 'x-vhost') ||
    /communique-dispatcher|dispatcher/.test(server)
  ) {
    return SERVER.DISPATCHER;
  }

  // AEM publish / origin — Sling / Day-Communique signals.
  if (
    /day-communique|communiqu|sling|jetty\/.*aem/.test(server) ||
    has(h, 'x-aem-instance') ||
    has(h, 'x-content-source') ||
    hasPrefix(h, 'x-aem-')
  ) {
    return SERVER.ORIGIN;
  }

  return SERVER.UNKNOWN;
}
