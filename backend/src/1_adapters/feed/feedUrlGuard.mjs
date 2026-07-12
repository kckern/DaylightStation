// backend/src/1_adapters/feed/feedUrlGuard.mjs
/**
 * feedUrlGuard
 *
 * SSRF protection for the Feed content boundary.
 *
 * The Feed feature exposes server-side URL-fetch endpoints (`/feed/image`,
 * `/feed/readable`, `/feed/icon`) that fetch a *client-supplied* URL from the
 * server. Without validation these are classic SSRF vectors: a caller could
 * point them at internal services (Plex, Home Assistant), the cloud metadata
 * endpoint (169.254.169.254), or loopback.
 *
 * This module validates URLs against a private/reserved-range blocklist and
 * provides a hardened `safeFetch` that re-validates on every redirect hop and
 * caps the response size. It deliberately lives at the Feed boundary and does
 * NOT touch the shared HttpClient, which legitimately reaches internal hosts.
 *
 * @module adapters/feed/feedUrlGuard
 */

import { promises as dns } from 'node:dns';
import net from 'node:net';

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;

/**
 * Parse an IPv4 dotted-quad string into an unsigned 32-bit integer.
 *
 * @param {string} ip
 * @returns {number|null} The integer value, or null if not a valid IPv4 literal.
 */
function ipv4ToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const octet = Number(part);
    if (octet < 0 || octet > 255) return null;
    value = (value * 256) + octet;
  }
  return value >>> 0;
}

/**
 * Test whether an IPv4 integer falls inside a CIDR block.
 *
 * @param {number} value - Unsigned 32-bit address.
 * @param {number} baseValue - Unsigned 32-bit network base.
 * @param {number} prefix - Prefix length (0-32).
 * @returns {boolean}
 */
function inCidrV4(value, baseValue, prefix) {
  if (prefix === 0) return true;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

// IPv4 blocked ranges as [dotted-base, prefix].
const BLOCKED_V4 = [
  ['0.0.0.0', 8],       // "this" network
  ['10.0.0.0', 8],      // private
  ['127.0.0.0', 8],     // loopback
  ['169.254.0.0', 16],  // link-local (incl. cloud metadata 169.254.169.254)
  ['172.16.0.0', 12],   // private
  ['192.168.0.0', 16],  // private
  ['100.64.0.0', 10],   // CGNAT
  ['192.0.0.0', 24],    // IETF protocol assignments
  ['192.0.2.0', 24],    // TEST-NET-1 (documentation)
  ['198.18.0.0', 15],   // benchmarking
  ['240.0.0.0', 4],     // reserved / future use (covers 255.255.255.255)
];

/**
 * Determine whether an IP literal (v4 or v6) is in a blocked/reserved range.
 *
 * @param {string} ip - An IP literal string.
 * @returns {boolean} True if the address must be blocked.
 */
export function isBlockedIp(ip) {
  const family = net.isIP(ip);

  if (family === 4) {
    const value = ipv4ToInt(ip);
    if (value === null) return true; // unparseable → treat as unsafe
    if (value === 0xffffffff) return true; // 255.255.255.255 broadcast
    for (const [base, prefix] of BLOCKED_V4) {
      if (inCidrV4(value, ipv4ToInt(base), prefix)) return true;
    }
    return false;
  }

  if (family === 6) {
    const normalized = ip.toLowerCase();

    // Loopback (::1) and unspecified (::)
    if (normalized === '::1' || normalized === '::') return true;

    // IPv4-mapped ::ffff:0:0/96 — extract embedded IPv4 and re-check.
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedIp(mapped[1]);
    // Some resolvers emit the mapped form in hex (::ffff:a.b.c.d written as ::ffff:xxxx:xxxx).
    const mappedHex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const hi = parseInt(mappedHex[1], 16);
      const lo = parseInt(mappedHex[2], 16);
      const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      return isBlockedIp(v4);
    }

    // Expand to full 8-group form to read the leading bits.
    const firstGroup = expandIpv6FirstGroup(normalized);
    if (firstGroup === null) return true; // unparseable → unsafe

    // fc00::/7 unique-local (fc00–fdff)
    if ((firstGroup & 0xfe00) === 0xfc00) return true;
    // fe80::/10 link-local (fe80–febf)
    if ((firstGroup & 0xffc0) === 0xfe80) return true;

    return false;
  }

  // Not a recognizable IP literal → unsafe.
  return true;
}

/**
 * Return the first 16-bit group of an IPv6 address as an integer.
 *
 * @param {string} ip - Lowercased IPv6 literal (no zone id).
 * @returns {number|null}
 */
function expandIpv6FirstGroup(ip) {
  let addr = ip;
  // Strip zone id if present (e.g. fe80::1%eth0).
  const pct = addr.indexOf('%');
  if (pct !== -1) addr = addr.slice(0, pct);

  const halves = addr.split('::');
  if (halves.length > 2) return null;

  let head;
  if (halves.length === 2) {
    head = halves[0] === '' ? [] : halves[0].split(':');
  } else {
    head = addr.split(':');
  }

  if (head.length === 0) return 0; // e.g. "::..." → leading group is 0
  const first = head[0];
  if (!/^[0-9a-f]{1,4}$/.test(first)) return null;
  return parseInt(first, 16);
}

/**
 * Validate that a URL is a public, fetchable http(s) target.
 *
 * Rejects non-http(s) protocols, embedded credentials, and any hostname that
 * resolves (or is a literal) to a private/reserved/loopback/link-local address.
 *
 * @param {string} rawUrl - The client-supplied URL.
 * @returns {Promise<string>} The normalized `href` of the validated URL.
 * @throws {Error} If the URL is malformed or resolves to a blocked address.
 */
export async function assertPublicHttpUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${String(rawUrl)}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Blocked protocol: ${url.protocol}`);
  }

  if (url.username || url.password) {
    throw new Error('Blocked URL: embedded credentials are not allowed');
  }

  // Hostname may carry brackets for IPv6 literals; strip them for net.isIP.
  const hostname = url.hostname.replace(/^\[/, '').replace(/\]$/, '');
  if (!hostname) {
    throw new Error('Blocked URL: empty hostname');
  }

  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new Error(`Blocked address (reserved/private range): ${hostname}`);
    }
    return url.href;
  }

  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch (err) {
    throw new Error(`DNS resolution failed for ${hostname}: ${err.message}`);
  }

  if (!addresses.length) {
    throw new Error(`No addresses resolved for ${hostname}`);
  }

  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw new Error(`Blocked address (reserved/private range): ${hostname} → ${address}`);
    }
  }

  return url.href;
}

/**
 * Fetch a URL with SSRF protection, redirect re-validation, and a byte cap.
 *
 * @param {string} url - The initial URL to fetch.
 * @param {Object} [opts]
 * @param {Object} [opts.headers] - Request headers.
 * @param {number} [opts.timeoutMs=8000] - Abort timeout in ms.
 * @param {number} [opts.maxBytes=10485760] - Max response body size in bytes.
 * @param {number} [opts.maxRedirects=3] - Max redirect hops to follow.
 * @param {'buffer'|'text'} [opts.responseType='buffer'] - Response decoding.
 * @returns {Promise<{ status: number, headers: Object, ok: boolean, data: Buffer|string }>}
 * @throws {Error} On blocked target, too many redirects, or oversize response.
 */
export async function safeFetch(url, {
  headers = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_BYTES,
  maxRedirects = DEFAULT_MAX_REDIRECTS,
  responseType = 'buffer',
} = {}) {
  let currentUrl = await assertPublicHttpUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let redirects = 0;

    while (true) {
      const response = await fetch(currentUrl, {
        headers,
        redirect: 'manual',
        signal: controller.signal,
      });

      // Follow redirects manually, re-validating each hop.
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (location) {
          if (redirects >= maxRedirects) {
            throw new Error(`Too many redirects (>${maxRedirects})`);
          }
          redirects += 1;
          const nextUrl = new URL(location, currentUrl).href;
          currentUrl = await assertPublicHttpUrl(nextUrl);
          continue;
        }
        // 3xx without a Location — treat as a terminal response.
      }

      const responseHeaders = Object.fromEntries(response.headers.entries());
      const buffer = await readCapped(response, maxBytes, controller);

      const data = responseType === 'text' ? buffer.toString('utf-8') : buffer;
      return {
        status: response.status,
        headers: responseHeaders,
        ok: response.ok,
        data,
      };
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read a fetch Response body, enforcing a maximum byte count by streaming.
 *
 * @param {Response} response
 * @param {number} maxBytes
 * @param {AbortController} controller - Aborted if the cap is exceeded.
 * @returns {Promise<Buffer>}
 * @throws {Error} If the body exceeds maxBytes.
 */
async function readCapped(response, maxBytes, controller) {
  if (!response.body) {
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length > maxBytes) {
      throw new Error('Response exceeded maxBytes');
    }
    return buf;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.length;
      if (total > maxBytes) {
        try { controller.abort(); } catch { /* already aborting */ }
        try { await reader.cancel(); } catch { /* best effort */ }
        throw new Error('Response exceeded maxBytes');
      }
      chunks.push(Buffer.from(value));
    }
  }

  return Buffer.concat(chunks, total);
}
