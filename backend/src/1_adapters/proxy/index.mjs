/**
 * Proxy Adapters
 *
 * Adapters for proxying requests to external media/content services.
 * Each adapter implements IProxyAdapter for use with ProxyService.
 *
 * @module adapters/proxy
 */

export { PlexProxyAdapter, createPlexProxyAdapter } from './PlexProxyAdapter.mjs';
export { ImmichProxyAdapter, createImmichProxyAdapter } from './ImmichProxyAdapter.mjs';
export { AudiobookshelfProxyAdapter, createAudiobookshelfProxyAdapter } from './AudiobookshelfProxyAdapter.mjs';
export { FreshRSSProxyAdapter, createFreshRSSProxyAdapter } from './FreshRSSProxyAdapter.mjs';
export { KomgaProxyAdapter, createKomgaProxyAdapter } from './KomgaProxyAdapter.mjs';
