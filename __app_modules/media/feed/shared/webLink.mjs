/**
 * Feed links come from other people's RSS and FreshRSS, unchecked. The app
 * renders them as anchors and as the src of an iframe sandboxed with
 * `allow-scripts allow-same-origin`. So a link is usable only as an absolute
 * http(s) URL: `javascript:` in an anchor would run in the app's page, and
 * `data:`/`blob:` or a relative path in that iframe would run with the app's
 * origin. __docs/reference/core/network-exposure.md (Cross-site requests).
 */

/**
 * The link, trimmed, when it is an absolute http(s) URL; else null. Returned
 * as given rather than re-serialized: harvested headline ids hash the link.
 */
export function webLink(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  // Absolute URLs only: no relative or protocol-relative paths, which would
  // resolve against the app's own origin.
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * The link if it may be loaded into an iframe sandboxed with
 * `allow-scripts allow-same-origin`, or null. That pair is harmless only for
 * another origin: a page on the app's own origin could reach out of the
 * sandbox and drive the app as the household member.
 * @param {string} value
 * @param {string} appOrigin - the page's origin (`window.location.origin`)
 */
export function frameableLink(value, appOrigin) {
  const link = webLink(value);
  if (!link) return null;
  let own = null;
  try { own = new URL(appOrigin).origin; } catch { own = null; }
  return own && new URL(link).origin === own ? null : link;
}
