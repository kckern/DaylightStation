const PERMANENT_FAILURES = new Set(['metadata-missing', 'non-playable-type', 'audio-key-missing']);

/**
 * Test-only semantic facade for legacy fixtures that place a raw adapter on
 * the content-id resolution object. Production uses RegistryContentCatalogGateway.
 */
export function resolvedAdapterContentCatalog() {
  return {
    async resolvePlayables(resolution, contentRef) {
      const adapter = resolution?.adapter;
      return typeof adapter?.resolvePlayables === 'function'
        ? adapter.resolvePlayables(contentRef)
        : null;
    },

    async preparePlayback(resolution, item, options) {
      const adapter = resolution?.adapter;
      if (typeof adapter?.loadMediaUrl !== 'function') {
        return { kind: 'unsupported', reason: 'not plex' };
      }
      const result = await adapter.loadMediaUrl(item, options);
      if (result?.url) return { kind: 'ready', url: result.url };
      const reason = result?.reason ?? 'loadMediaUrl returned null';
      return { kind: 'failed', reason, permanent: PERMANENT_FAILURES.has(reason) };
    },
  };
}
