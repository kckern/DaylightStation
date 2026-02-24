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

      const consoleId = this.#resolveConsoleId(items[0]?.core_path, playlist.n);
      if (!consoleId) {
        this.#logger.warn?.('retroarch.sync.unknownCore', { playlist: playlist.n, core: items[0]?.core_path });
        continue;
      }

      // Playlist name (minus .lpl) is the RetroArch thumbnail directory name
      const playlistName = playlist.n.replace(/\.lpl$/, '');
      const thumbSubdir = this.#sourceConfig.thumbnail_subdir || 'Named_Boxarts';

      if (!games[consoleId]) games[consoleId] = [];
      games[consoleId].push(...items.map(item => ({
        id: this.#slugify(item.label),
        title: item.label,
        rom: item.path,
        thumbnail: `${encodeURIComponent(playlistName)}/${thumbSubdir}/${encodeURIComponent(this.#sanitizeThumbnailName(item.label))}.png`,
        crc32: item.crc32
      })));

      totalGames += items.length;
    }

    // 2b. Measure thumbnail dimensions and fetch save file timestamps in parallel
    const thumbsPath = this.#sourceConfig.thumbnails_path;
    const savesPath = this.#sourceConfig.saves_path || '/storage/emulated/0/RetroArch/saves';

    // Fetch saves directory listing (non-fatal)
    const saveTimesMap = {};
    try {
      const savesResponse = await this.#httpClient.get(`${baseUrl}${savesPath}?cmd=list`, { timeout: 10000 });
      const saveFiles = savesResponse.data?.files || [];
      for (const f of saveFiles) {
        if (!f.n || !f.time) continue;
        // Strip extension (.srm, .sav, .rtc) to get the ROM base name
        const baseName = f.n.replace(/\.(srm|sav|rtc|state\d*)$/i, '');
        // Keep the most recent timestamp per base name
        if (!saveTimesMap[baseName] || f.time > saveTimesMap[baseName]) {
          saveTimesMap[baseName] = f.time;
        }
      }
      this.#logger.info?.('retroarch.sync.savesFetched', { count: Object.keys(saveTimesMap).length });
    } catch (err) {
      this.#logger.warn?.('retroarch.sync.savesSkipped', { error: err.message });
    }

    // Measure thumbnails
    const measurePromises = [];
    for (const [consoleId, gameList] of Object.entries(games)) {
      for (const game of gameList) {
        if (!game.thumbnail) continue;
        measurePromises.push(
          this.#measurePngDimensions(`${baseUrl}${thumbsPath}/${game.thumbnail}`)
            .then(dims => { if (dims) game.thumbRatio = dims.height / dims.width; })
            .catch(() => {}) // non-fatal — leave thumbRatio undefined
        );
      }
    }
    await Promise.all(measurePromises);
    this.#logger.info?.('retroarch.sync.thumbnailsMeasured', {
      measured: measurePromises.length,
      withRatio: Object.values(games).flat().filter(g => g.thumbRatio).length
    });

    // 2c. Match save timestamps to games by ROM filename
    let savesMatched = 0;
    for (const gameList of Object.values(games)) {
      for (const game of gameList) {
        // ROM path e.g. "/storage/emulated/0/Games/GB/Pokemon Red (UE) [S][!].gb"
        // Save file base name e.g. "Pokemon Red (UE) [S][!]"
        const romFile = game.rom.split('/').pop();
        const romBase = romFile.replace(/\.[^.]+$/, '');
        if (saveTimesMap[romBase]) {
          game.lastPlayed = new Date(saveTimesMap[romBase]).toISOString();
          savesMatched++;
        }
      }
    }
    this.#logger.info?.('retroarch.sync.savesMatched', { matched: savesMatched, total: totalGames });

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

  #resolveConsoleId(corePath, playlistName = '') {
    if (!corePath) return null;
    const coreFilename = corePath.split('/').pop();
    const matches = [];
    for (const [consoleId, cfg] of Object.entries(this.#consoleConfig)) {
      const cfgFilename = cfg.core?.split('/').pop();
      if (cfgFilename && cfgFilename === coreFilename) matches.push(consoleId);
    }
    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0];
    // Multiple consoles share same core (e.g. gb/gbc both use gambatte).
    // Disambiguate by matching console label against playlist name.
    // Prefer longest label match to avoid "Game Boy" matching "Game Boy Color".
    const plName = playlistName.replace(/\.lpl$/, '').toLowerCase();
    const labelMatches = matches
      .map(id => ({ id, label: this.#consoleConfig[id].label?.toLowerCase() || '' }))
      .filter(m => plName.includes(m.label))
      .sort((a, b) => b.label.length - a.label.length);
    return labelMatches.length ? labelMatches[0].id : matches[0];
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

  /** Fetch a PNG from X-plore and read width/height from the IHDR chunk header */
  async #measurePngDimensions(url) {
    const response = await this.#httpClient.get(`${url}?cmd=file`, {
      responseType: 'arraybuffer',
      timeout: 10000
    });
    const buf = Buffer.from(response.data);
    // PNG signature (8 bytes) + IHDR length (4) + IHDR type (4) + width (4) + height (4) = 24 bytes
    if (buf.length < 24 || buf[0] !== 0x89 || buf[1] !== 0x50) return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
}

export default RetroArchSyncAdapter;
