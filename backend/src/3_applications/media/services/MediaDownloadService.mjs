/**
 * MediaDownloadService
 *
 * Application layer service for media metadata operations.
 * Wraps the video source gateway for channel metadata fetching
 * and thumbnail downloading, keeping adapter references out of
 * the API layer.
 *
 * @module applications/media/services/MediaDownloadService
 */


/**
 * Application service for media download operations (metadata, thumbnails)
 */
export class MediaDownloadService {
  #videoSourceGateway;
  #newsMediaStore;
  #downloadThumbnail;
  #logger;

  /**
   * @param {Object} deps - Dependencies
   * @param {Object} deps.videoSourceGateway - Gateway implementing fetchChannelMetadata/downloadThumbnail
   * @param {Object} deps.newsMediaStore - Persisted metadata and thumbnail-address port
   * @param {Function} deps.downloadThumbnail - (url, provider) => Promise<boolean>
   * @param {Object} [deps.logger] - Logger instance
   */
  constructor({ videoSourceGateway, newsMediaStore, downloadThumbnail, logger }) {
    if (!videoSourceGateway) {
      throw new Error('MediaDownloadService requires videoSourceGateway');
    }
    if (!newsMediaStore) {
      throw new Error('MediaDownloadService requires newsMediaStore');
    }
    if (typeof downloadThumbnail !== 'function') {
      throw new Error('MediaDownloadService requires downloadThumbnail');
    }

    this.#videoSourceGateway = videoSourceGateway;
    this.#newsMediaStore = newsMediaStore;
    this.#downloadThumbnail = downloadThumbnail;
    this.#logger = logger || console;
  }

  /**
   * Fetch and persist channel metadata for a single source
   *
   * @param {Object} source - Provider-neutral source descriptor with opaque sourceRef
   * @returns {Promise<{ok: boolean, title?: string, thumbnailDownloaded: boolean, error?: string}>}
   */
  async fetchAndSaveMetadata(source) {
    const hasThumbnail = this.#newsMediaStore.hasThumbnail(source.provider);

    this.#logger.info?.('mediaDownload.metadata.fetching', { provider: source.provider });
    const metadata = await this.#videoSourceGateway.fetchChannelMetadata(source);

    if (!metadata) {
      return { ok: false, thumbnailDownloaded: false, error: 'Failed to fetch channel metadata' };
    }

    // Save metadata.yml
    this.#newsMediaStore.saveMetadata(source.provider, {
      title: metadata.title,
      description: metadata.description,
      uploader: metadata.uploader,
      thumbnailUrl: metadata.thumbnailUrl
    });

    this.#logger.info?.('mediaDownload.metadata.saved', { provider: source.provider, title: metadata.title });

    // Download thumbnail if available and not already present
    let thumbnailDownloaded = false;
    if (metadata.thumbnailUrl && !hasThumbnail) {
      thumbnailDownloaded = await this.#downloadThumbnail(metadata.thumbnailUrl, source.provider);
      if (thumbnailDownloaded) {
        this.#logger.info?.('mediaDownload.thumbnail.saved', {
          provider: source.provider,
          assetId: `${source.provider}:thumbnail`,
        });
      }
    }

    return {
      ok: true,
      title: metadata.title,
      thumbnailDownloaded,
      ...this.#newsMediaStore.publicReferences(source.provider, { thumbnail: thumbnailDownloaded }),
    };
  }

  /**
   * Fetch and persist metadata for multiple sources
   *
   * @param {Object[]} sources - Array of adapter-format source configs
   * @returns {Promise<{results: Object[], total: number, success: number}>}
   */
  async fetchAndSaveMetadataAll(sources) {
    const results = [];

    for (const source of sources) {
      try {
        const result = await this.fetchAndSaveMetadata(source);
        results.push({
          provider: source.provider,
          success: result.ok,
          title: result.title,
          thumbnailDownloaded: result.thumbnailDownloaded,
          ...(result.error ? { error: result.error } : {})
        });
      } catch (err) {
        results.push({
          provider: source.provider,
          success: false,
          error: err.message
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    this.#logger.info?.('mediaDownload.metadata.all.complete', {
      total: results.length,
      success: successCount
    });

    return { results, total: results.length, success: successCount };
  }
}

export default MediaDownloadService;
