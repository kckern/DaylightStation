/**
 * FreshVideoService
 *
 * Application layer service for orchestrating daily video downloads.
 * Coordinates file management, retention, and download execution via gateway.
 *
 * Key responsibilities:
 * - File locking to prevent concurrent runs
 * - Retention cleanup (remove old dated files)
 * - Invalid file cleanup (partial downloads)
 * - Orchestrate downloads via injected gateway
 *
 * NOTE: This service has NO knowledge of yt-dlp, YouTube URLs, or video codecs.
 * All platform-specific logic is delegated to the VideoSourceGateway adapter.
 *
 * @module applications/media/services/FreshVideoService
 */

import { nowTs24 } from '#system/utils/index.mjs';

/**
 * Application service for fresh video downloads
 */
export class FreshVideoService {
  #videoSourceGateway;
  #configLoader;
  #logger;
  #options;
  #mediaStore;
  #lockOwnerId;

  /**
   * @param {Object} deps - Dependencies
   * @param {Object} deps.videoSourceGateway - Gateway implementing IVideoSourceGateway
   * @param {Function} deps.configLoader - Function returning array of source configs
   * @param {Object} deps.mediaStore - Fresh-video persistence capability
   * @param {Object} [deps.logger] - Logger instance
   * @param {Object} [deps.options] - Service options
   * @param {number} [deps.options.daysToKeep=10] - Days to retain videos
   * @param {number} [deps.options.processTimeout=300000] - Download timeout in ms
   * @param {string} [deps.options.audioLang='en'] - Preferred audio language
   * @param {number} [deps.options.lockStaleMs=3600000] - Lock file stale threshold (1 hour)
   */
  constructor({ videoSourceGateway, configLoader, mediaStore, lockOwnerId, logger, options = {} }) {
    if (!videoSourceGateway) {
      throw new Error('FreshVideoService requires videoSourceGateway');
    }
    if (!configLoader) {
      throw new Error('FreshVideoService requires configLoader');
    }
    if (!mediaStore) throw new Error('FreshVideoService requires mediaStore');
    if (lockOwnerId === undefined || lockOwnerId === null) throw new Error('FreshVideoService requires lockOwnerId');

    this.#videoSourceGateway = videoSourceGateway;
    this.#configLoader = configLoader;
    this.#mediaStore = mediaStore;
    this.#lockOwnerId = lockOwnerId;
    this.#logger = logger || console;
    this.#options = {
      daysToKeep: 10,
      processTimeout: 300000,
      audioLang: 'en',
      lockStaleMs: 60 * 60 * 1000,
      ...options
    };

  }

  /**
   * Format date as YYYYMMDD
   * @param {Date} [date] - Date to format (defaults to now)
   * @returns {string} Formatted date
   */
  #formatDate(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }

  /**
   * Calculate cutoff date for retention
   * @returns {string} Cutoff date as YYYYMMDD
   */
  #getCutoffDate() {
    const date = new Date();
    date.setDate(date.getDate() - this.#options.daysToKeep);
    return this.#formatDate(date);
  }

  /**
   * Acquire file lock to prevent concurrent runs
   * @returns {Function|null} Release function or null if lock held
   */
  #acquireLock() {
    return this.#mediaStore.acquireRunLock(this.#lockOwnerId, this.#options.lockStaleMs, nowTs24());
  }

  /**
   * Remove files older than retention period
   * @returns {string[]} Paths of deleted files
   */
  #cleanupOldFiles() {
    return this.#mediaStore.cleanupOlderThan(this.#getCutoffDate());
  }

  /**
   * Remove files not matching valid pattern (partial downloads, temp files)
   * @returns {number} Count of removed files
   */
  #cleanupInvalidFiles(provider = null) {
    return this.#mediaStore.cleanupInvalid(provider);
  }

  /**
   * Check if today's file already exists for a source
   * @returns {unknown|null} Opaque media resource if it exists
   */
  #getTodayFile(provider) {
    return this.#mediaStore.findDatedVideo(provider, this.#formatDate());
  }

  /**
   * Ensure channel metadata exists (title, thumbnail)
   * Fetches from the source when provider metadata is absent.
   * @param {Object} source - Source configuration
   */
  async #ensureChannelMetadata(source) {
    // Check if metadata already exists
    const existingMetadata = this.#mediaStore.loadProviderMetadata(source.provider);
    if (existingMetadata?.title) {
      this.#logger.debug?.('freshvideo.metadataExists', {
        provider: source.provider
      });
      return;
    }

    // Fetch channel metadata if gateway supports it
    if (!this.#videoSourceGateway.fetchChannelMetadata) {
      return;
    }

    this.#logger.info?.('freshvideo.fetchingMetadata', {
      provider: source.provider
    });

    const metadata = await this.#videoSourceGateway.fetchChannelMetadata(source);
    if (!metadata) {
      return;
    }

    this.#mediaStore.saveProviderMetadata(source.provider, {
      title: metadata.title,
      description: metadata.description,
      uploader: metadata.uploader,
      thumbnailUrl: metadata.thumbnailUrl
    });

    this.#logger.info?.('freshvideo.metadataSaved', {
      provider: source.provider,
      title: metadata.title
    });

    // Download thumbnail if available and gateway supports it
    if (metadata.thumbnailUrl && this.#videoSourceGateway.downloadThumbnail) {
      const downloaded = await this.#videoSourceGateway.downloadThumbnail(
        metadata.thumbnailUrl,
        source.provider
      );
      if (downloaded) {
        this.#logger.info?.('freshvideo.thumbnailSaved', {
          provider: source.provider,
          assetId: `${source.provider}:thumbnail`
        });
      }
    }
  }

  /**
   * Download latest video from a source
   * @param {Object} source - Source configuration
   * @returns {Promise<{success: boolean, skipped?: boolean, resource?: unknown, error?: string}>}
   */
  async #downloadSource(source) {
    this.#mediaStore.ensureProvider(source.provider);

    // Ensure channel metadata exists (title, thumbnail for admin UI)
    await this.#ensureChannelMetadata(source);

    // Check if already have today's file
    const existingResource = this.#getTodayFile(source.provider);
    if (existingResource) {
      this.#logger.info?.('freshvideo.alreadyExists', {
        provider: source.provider,
        assetId: `${source.provider}:${this.#formatDate()}`,
      });
      return {
        success: true,
        skipped: true,
        resource: existingResource,
      };
    }

    // Delegate to gateway
    const outcome = await this.#videoSourceGateway.downloadLatest(source, {
      timeoutMs: this.#options.processTimeout,
      preferredLang: this.#options.audioLang
    });

    if (outcome.kind === 'downloaded') {
      const uploadDate = outcome.uploadDate || this.#formatDate();
      const resource = this.#mediaStore.findDatedVideo(source.provider, uploadDate);
      this.#logger.info?.('freshvideo.downloadSuccess', {
        provider: source.provider,
        assetId: outcome.assetId,
      });
      return { success: true, resource, uploadDate };
    } else {
      this.#logger.error?.('freshvideo.downloadFailed', {
        provider: source.provider,
        error: outcome.error
      });
    }

    return { success: false, error: outcome.error };
  }

  /**
   * Get list of all valid video files within retention period
   * @returns {unknown[]} Opaque media resources
   */
  #getValidFiles() {
    return this.#mediaStore.listVideosSince(this.#getCutoffDate());
  }

  /**
   * Run the download job
   * @returns {Promise<Object>} Job result
   */
  async run() {
    // Acquire lock
    const releaseLock = this.#acquireLock();
    if (!releaseLock) {
      this.#logger.warn?.('freshvideo.lockHeld', {
        message: 'Another instance is running'
      });
      return {
        skipped: true,
        reason: 'lock_held',
        deleted: [],
        providers: [],
        files: []
      };
    }

    try {
      // Load source configuration
      const sources = await this.#configLoader();
      if (!Array.isArray(sources) || sources.length === 0) {
        this.#logger.warn?.('freshvideo.noConfig', {
          message: 'No sources configured'
        });
        return {
          skipped: true,
          reason: 'no_config',
          deleted: [],
          providers: [],
          files: []
        };
      }

      // Cleanup old files
      const deleted = this.#cleanupOldFiles();

      // Cleanup invalid files in base directory
      this.#cleanupInvalidFiles();

      // Download each source
      const providers = [];
      const results = [];

      for (const source of sources) {
        const result = await this.#downloadSource(source);
        providers.push(source.provider);
        results.push({
          provider: source.provider,
          ...result
        });

        // Cleanup invalid files in provider directory after each download
        this.#cleanupInvalidFiles(source.provider);
      }

      // Get final file list
      const files = this.#getValidFiles();

      return {
        skipped: false,
        deleted,
        providers,
        files,
        results
      };

    } finally {
      releaseLock();
    }
  }
}

export default FreshVideoService;
