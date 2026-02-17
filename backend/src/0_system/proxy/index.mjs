/**
 * Proxy Infrastructure
 *
 * Provides generic HTTP proxy functionality with authentication
 * injection and retry logic for external services.
 *
 * Usage:
 *   import { ProxyService, isProxyAdapter } from './0_system/proxy/index.mjs';
 *
 *   const proxyService = new ProxyService({ logger });
 *   proxyService.register(new PlexProxyAdapter(config));
 *
 *   // In Express router
 *   router.use('/plex', proxyService.createMiddleware('plex'));
 *
 * @module infrastructure/proxy
 */

export { IProxyAdapter, isProxyAdapter } from './IProxyAdapter.mjs';
export { ProxyService, createProxyService } from './ProxyService.mjs';
export { PLACEHOLDER_SVG, sendPlaceholderSvg } from './placeholders.mjs';

// Default export
import { ProxyService } from './ProxyService.mjs';
export default ProxyService;
