/**
 * Select the publishable presentation catalog.  The catalog port supplies
 * validated data; this use case owns which assets and metadata are safe for
 * a runtime client to receive.
 */
export class GetPublicPresentationCatalog {
  #catalog;

  constructor({ catalog } = {}) {
    if (!catalog?.get) throw new Error('GetPublicPresentationCatalog: catalog required');
    this.#catalog = catalog;
  }

  execute(packId) {
    const loaded = this.#catalog.get(packId);
    if (!loaded) return null;
    const assets = Object.fromEntries(Object.entries(loaded.assets || {})
      .filter(([, asset]) => asset.status === 'approved')
      .map(([id, asset]) => {
        const { source, source_sha256: sourceSha256, provenance, distribution, ...publicAsset } = asset;
        void source; void sourceSha256; void provenance; void distribution;
        return [id, publicAsset];
      }));
    return { ...loaded, kind: 'presentation-runtime-catalog', assets, asset_templates: undefined, imports: undefined };
  }
}

export default GetPublicPresentationCatalog;
