/** Remote thumbnail retrieval gateway. */
export class IRemoteThumbnailSource {
  async fetchThumbnail(_thumbnailId) { throw new Error('fetchThumbnail not implemented'); }
}

export default IRemoteThumbnailSource;
