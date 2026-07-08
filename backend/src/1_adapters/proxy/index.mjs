/**
 * Proxy Adapters
 *
 * Adapters for proxying requests to external media/content services.
 * Each adapter implements IProxyAdapter for use with ProxyService.
 *
 * @module adapters/proxy
 */

export { PlexProxyAdapter } from './PlexProxyAdapter.mjs';
export { ImmichProxyAdapter } from './ImmichProxyAdapter.mjs';
export { AudiobookshelfProxyAdapter } from './AudiobookshelfProxyAdapter.mjs';
export { FreshRSSProxyAdapter } from './FreshRSSProxyAdapter.mjs';
export { KomgaProxyAdapter } from './KomgaProxyAdapter.mjs';
