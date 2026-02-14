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

import path from 'path';
import fs from 'fs';
import { loadYamlSafe, saveYaml, ensureDir } from '#system/utils/FileIO.mjs';

/**
 * Application service for media download operations (metadata, thumbnails)
 */
export class MediaDownloadService {
  #videoSourceGateway;
  #mediaPath;
  #logger;

  /**
   * @param {Object} deps - Dependencies
   * @param {Object} deps.videoSourceGateway - Gateway implementing fetchChannelMetadata/downloadThumbnail
   * @param {string} deps.mediaPath - Base path for media storage
   * @param {Object} [deps.logger] - Logger instance
   */
  constructor({ videoSourceGateway, mediaPath, logger }) {
    if (!videoSourceGateway) {
      throw new Error('MediaDownloadService requires videoSourceGateway');
    }
    if (!mediaPath) {
      throw new Error('MediaDownloadService requires mediaPath');
    }

    this.#videoSourceGateway = videoSourceGateway;
    this.#mediaPath = mediaPath;
    this.#logger = logger || console;
  }

  /**
   * Fetch and persist channel metadata for a single source
   *
   * @param {Object} source - Adapter-format source config
   * @param {string} source.provider - Provider shortcode
   * @param {string} source.src - Platform (e.g. 'youtube')
   * @param {string} source.type - Source type ('channel' | 'playlist')
   * @param {string} source.id - Platform-specific identifier
   * @returns {Promise<{ok: boolean, title?: string, thumbnailDownloaded: boolean, error?: string}>}
   */
  async fetchAndSaveMetadata(source) {
    const providerDir = path.join(this.#mediaPath, 'video', 'news', source.provider);
    ensureDir(providerDir);

    const metadataPath = path.join(providerDir, 'metadata');
    const thumbnailPath = path.join(providerDir, 'show.jpg');
    const hasThumbnail = fs.existsSync(thumbnailPath);

    this.#logger.info?.('mediaDownload.metadata.fetching', { provider: source.provider });
    const metadata = await this.#videoSourceGateway.fetchChannelMetadata(source);

    if (!metadata) {
      return { ok: false, thumbnailDownloaded: false, error: 'Failed to fetch channel metadata' };
    }

    // Save metadata.yml
    saveYaml(metadataPath, {
      title: metadata.title,
      description: metadata.description,
      uploader: metadata.uploader,
      thumbnailUrl: metadata.thumbnailUrl
    });

    this.#logger.info?.('mediaDownload.metadata.saved', { provider: source.provider, title: metadata.title });

    // Download thumbnail if available and not already present
    let thumbnailDownloaded = false;
    if (metadata.thumbnailUrl && !hasThumbnail) {
      thumbnailDownloaded = await this.#videoSourceGateway.downloadThumbnail(
        metadata.thumbnailUrl,
        thumbnailPath
      );
      if (thumbnailDownloaded) {
        this.#logger.info?.('mediaDownload.thumbnail.saved', { provider: source.provider, path: thumbnailPath });
      }
    }

    return {
      ok: true,
      title: metadata.title,
      thumbnailDownloaded,
      metadataRelPath: `media/video/news/${source.provider}/metadata.yml`,
      thumbnailRelPath: thumbnailDownloaded ? `media/video/news/${source.provider}/show.jpg` : null
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
