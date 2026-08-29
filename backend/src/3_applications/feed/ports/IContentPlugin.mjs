/** Port contract for content-specific feed enrichment. */
export class IContentPlugin {
  get contentType() { throw new Error('IContentPlugin.contentType must be implemented'); }
  detect() { return false; }
  enrich() { return {}; }
}
