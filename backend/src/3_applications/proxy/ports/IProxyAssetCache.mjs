/** Cache contract for generated proxy imagery and remote thumbnails. */
export class IProxyAssetCache {
  async findComposite(_compositeId) { throw new Error('findComposite not implemented'); }
  async storeComposite(_compositeId, _artifact) { throw new Error('storeComposite not implemented'); }
  async findThumbnail(_thumbnailId) { throw new Error('findThumbnail not implemented'); }
  async storeThumbnail(_thumbnailId, _artifact) { throw new Error('storeThumbnail not implemented'); }
}

export default IProxyAssetCache;
