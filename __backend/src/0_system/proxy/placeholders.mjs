/**
 * Shared placeholder SVG for failed image proxies.
 *
 * Used by both ProxyService (retry / error fallback) and the
 * proxy router (inline error paths) so the response is identical
 * regardless of which layer catches the failure.
 *
 * @module infrastructure/proxy/placeholders
 */

/**
 * Minimal transparent 1x1 SVG.
 * Renders as "nothing" rather than a broken-image icon.
 */
export const PLACEHOLDER_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';

/**
 * Send the placeholder SVG as an HTTP response.
 * Safe to call after headers have already been sent (no-ops in that case).
 *
 * @param {import('express').Response} res
 */
export function sendPlaceholderSvg(res) {
  if (res.headersSent) return;
  res.writeHead(200, {
    'Content-Type': 'image/svg+xml',
    'Content-Length': Buffer.byteLength(PLACEHOLDER_SVG),
    'Cache-Control': 'public, max-age=300',
    'X-Proxy-Fallback': 'true',
  });
  res.end(PLACEHOLDER_SVG);
}
