/** Semantic gaming catalog and media operations. */
export class GamingMediaService {
  constructor({ repository }) {
    if (!repository) throw new Error('GamingMediaService requires repository');
    this.repository = repository;
  }

  getCatalog(packId) {
    const catalog = this.repository.getCatalog(packId);
    if (catalog === undefined) return { kind: 'unavailable' };
    if (!catalog) return { kind: 'not_found' };
    const assets = Object.fromEntries(
      Object.entries(catalog.assets)
        .filter(([, asset]) => asset.status === 'approved')
        .map(([id, asset]) => {
          const { source, source_sha256, provenance, distribution, ...publicAsset } = asset;
          void source; void source_sha256; void provenance; void distribution;
          return [id, publicAsset];
        }),
    );
    return { kind: 'found', value: { schemaVersion: catalog.schema_version, pack: catalog.pack, assets } };
  }

  getAssetImage(packId, assetId) {
    return this.repository.getAssetImage(packId, assetId);
  }

  getPartyMedia(mediaId) {
    return this.repository.getPartyMedia(mediaId);
  }
}

export default GamingMediaService;
