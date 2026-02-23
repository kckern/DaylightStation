// backend/src/1_adapters/content/retroarch/RetroArchSyncAdapter.mjs

/**
 * Syncs RetroArch game catalog from X-plore WiFi File Manager.
 * Implements ISyncSource.
 */
export class RetroArchSyncAdapter {
  #xploreBaseUrl;
  #sourceConfig;
  #consoleConfig;
  #thumbnailBasePath;
  #httpClient;
  #readCatalog;
  #writeCatalog;
  #downloadThumbnail;
  #logger;

  constructor(options) {
    this.#xploreBaseUrl = options.xploreBaseUrl;
    this.#sourceConfig = options.sourceConfig;
    this.#consoleConfig = options.consoleConfig;
    this.#thumbnailBasePath = options.thumbnailBasePath;
    this.#httpClient = options.httpClient;
    this.#readCatalog = options.readCatalog;
    this.#writeCatalog = options.writeCatalog;
    this.#downloadThumbnail = options.downloadThumbnail;
    this.#logger = options.logger || console;
  }

  async sync() {
    this.#logger.info?.('retroarch.sync.start');
    const baseUrl = this.#xploreBaseUrl;

    // 1. Fetch playlist directory listing (X-plore returns { files: [{ n, size, ... }] })
    const playlistDir = `${baseUrl}${this.#sourceConfig.playlists_path}?cmd=list`;
    const dirResponse = await this.#httpClient.get(playlistDir);
    const files = dirResponse.data?.files || [];
    const playlists = files.filter(f => f.n?.endsWith('.lpl'));

    this.#logger.info?.('retroarch.sync.playlistsFetched', { count: playlists.length });

    // 2. Fetch and parse each playlist (RetroArch .lpl format: { items: [{ path, label, core_path }] })
    const games = {};
    let totalGames = 0;

    for (const playlist of playlists) {
      const playlistUrl = `${baseUrl}${this.#sourceConfig.playlists_path}/${encodeURIComponent(playlist.n)}`;
      let data;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await this.#httpClient.get(playlistUrl, { params: { cmd: 'file' }, timeout: 15000 });
          data = response.data;
          break;
        } catch (err) {
          this.#logger.warn?.('retroarch.sync.retrying', { playlist: playlist.n, attempt: attempt + 1, error: err.message });
          if (attempt === 2) throw err;
          await new Promise(r => setTimeout(r, 500));
        }
      }
      const items = data?.items || [];

      const consoleId = this.#resolveConsoleId(items[0]?.core_path);
      if (!consoleId) {
        this.#logger.warn?.('retroarch.sync.unknownCore', { playlist: playlist.n, core: items[0]?.core_path });
        continue;
      }

      // Playlist name (minus .lpl) is the RetroArch thumbnail directory name
      const playlistName = playlist.n.replace(/\.lpl$/, '');
      const thumbSubdir = this.#sourceConfig.thumbnail_subdir || 'Named_Boxarts';

      games[consoleId] = items.map(item => ({
        id: this.#slugify(item.label),
        title: item.label,
        rom: item.path,
        thumbnail: `${encodeURIComponent(playlistName)}/${thumbSubdir}/${encodeURIComponent(this.#sanitizeThumbnailName(item.label))}.png`,
        crc32: item.crc32
      }));

      totalGames += items.length;
    }

    // 3. Preserve existing overrides
    const existingCatalog = this.#readCatalog() || {};
    const overrides = existingCatalog.overrides || {};

    // 4. Write catalog
    const catalog = {
      sync: {
        last_synced: new Date().toISOString(),
        game_count: totalGames
      },
      games,
      overrides
    };

    this.#writeCatalog(catalog);
    this.#logger.info?.('retroarch.sync.complete', { totalGames });

    return { synced: totalGames, errors: 0 };
  }

  async getStatus() {
    const catalog = this.#readCatalog();
    if (!catalog) return { lastSynced: null, itemCount: 0 };
    return {
      lastSynced: catalog.sync?.last_synced || null,
      itemCount: catalog.sync?.game_count || 0
    };
  }

  #resolveConsoleId(corePath) {
    if (!corePath) return null;
    const coreFilename = corePath.split('/').pop();
    for (const [consoleId, cfg] of Object.entries(this.#consoleConfig)) {
      const cfgFilename = cfg.core?.split('/').pop();
      if (cfgFilename && cfgFilename === coreFilename) return consoleId;
    }
    return null;
  }

  #slugify(title) {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  /** RetroArch replaces &:/ with _ in thumbnail filenames */
  #sanitizeThumbnailName(label) {
    return label.replace(/[&:/]/g, '_');
  }
}

export default RetroArchSyncAdapter;
