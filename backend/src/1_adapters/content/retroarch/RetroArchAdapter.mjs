// backend/src/1_adapters/content/retroarch/RetroArchAdapter.mjs
import { LaunchableItem } from '#domains/content/entities/LaunchableItem.mjs';
import { Item } from '#domains/content/entities/Item.mjs';

/**
 * Content adapter for RetroArch games.
 * Reads from in-memory config + catalog (loaded at startup from YAML).
 * Never talks to X-plore or ADB directly.
 *
 * @implements {IContentSource}
 */
export class RetroArchAdapter {
  #config;
  #catalogReader;
  #logger;

  constructor({ config, catalog, catalogReader, logger }) {
    this.#config = config;
    this.#catalogReader = catalogReader || (() => catalog || { games: {}, overrides: {}, sync: {} });
    this.#logger = logger || console;
  }

  get #catalog() {
    return this.#catalogReader() || { games: {}, overrides: {}, sync: {} };
  }

  #stripPrefix(id) {
    return id?.replace(/^retroarch:/, '') || '';
  }

  get source() { return 'retroarch'; }
  get prefixes() { return [{ prefix: 'retroarch' }]; }

  async getList(id) {
    const localId = this.#stripPrefix(id);
    if (!localId) return this.#listConsoles();
    return this.#listGames(localId);
  }

  async getItem(id) {
    const localId = this.#stripPrefix(id);
    const { consoleId, gameId } = this.#parseLocalId(localId);
    if (!consoleId || !gameId) return null;

    const consoleConfig = this.#config.consoles?.[consoleId];
    const games = this.#catalog.games?.[consoleId] || [];
    const game = games.find(g => g.id === gameId);
    if (!game || !consoleConfig) return null;

    const overrides = this.#catalog.overrides?.[`${consoleId}/${gameId}`] || {};
    if (overrides.hidden) return null;

    const title = overrides.title || game.title;
    const launchTarget = `${this.#config.launch.package}/${this.#config.launch.activity}`;

    return new LaunchableItem({
      id: `retroarch:${consoleId}/${gameId}`,
      source: 'retroarch',
      localId: `${consoleId}/${gameId}`,
      title,
      type: 'game',
      thumbnail: game.thumbnail ? `/api/v1/proxy/retroarch/thumbnail/${game.thumbnail}` : null,
      metadata: { type: 'game', console: consoleId, parentTitle: consoleConfig.label, menuStyle: consoleConfig.menuStyle },
      launchIntent: {
        target: launchTarget,
        params: { ROM: game.rom, LIBRETRO: consoleConfig.core }
      },
      deviceConstraint: this.#config.launch.device_constraint || null,
      console: consoleId
    });
  }

  async resolvePlayables() { return []; }

  async resolveLaunchables() {
    const allGames = [];
    for (const consoleId of Object.keys(this.#config.consoles || {})) {
      allGames.push(...this.#listGames(consoleId));
    }
    return allGames;
  }

  async resolveSiblings(compoundId) {
    const localId = this.#stripPrefix(compoundId);
    const { consoleId } = this.#parseLocalId(localId);
    if (!consoleId) return null;

    const consoleConfig = this.#config.consoles?.[consoleId];
    if (!consoleConfig) return null;

    const games = await this.#listGames(consoleId);
    return {
      parent: {
        id: `retroarch:${consoleId}`,
        title: consoleConfig.label,
        source: 'retroarch',
        thumbnail: null
      },
      items: games
    };
  }

  getSearchCapabilities() {
    return { canonical: ['text'], specific: ['console'] };
  }

  async search(query) {
    const { text = '', console: consoleFilter, take = 50 } = query;
    const searchText = text.toLowerCase();
    const items = [];

    const consolesToSearch = consoleFilter
      ? [consoleFilter]
      : Object.keys(this.#catalog.games || {});

    for (const consoleId of consolesToSearch) {
      const games = this.#catalog.games?.[consoleId] || [];
      for (const game of games) {
        const overrides = this.#catalog.overrides?.[`${consoleId}/${game.id}`] || {};
        if (overrides.hidden) continue;
        const title = overrides.title || game.title;
        const matchesSearch = !searchText
          || title.toLowerCase().includes(searchText)
          || game.title.toLowerCase().includes(searchText);
        if (!matchesSearch) continue;

        const compoundId = `retroarch:${consoleId}/${game.id}`;
        items.push(new Item({
          id: compoundId,
          source: 'retroarch',
          localId: `${consoleId}/${game.id}`,
          title,
          type: 'game',
          thumbnail: game.thumbnail ? `/api/v1/proxy/retroarch/thumbnail/${game.thumbnail}` : null,
          metadata: { type: 'game', console: consoleId },
          actions: { launch: { contentId: compoundId } }
        }));

        if (items.length >= take) break;
      }
      if (items.length >= take) break;
    }

    return { items, total: items.length };
  }

  // ── Private ──────────────────────────────────────────

  #listConsoles() {
    const consoles = this.#config.consoles || {};
    return Object.entries(consoles).map(([id, cfg]) => {
      const gameCount = (this.#catalog.games?.[id] || []).length;
      const compoundId = `retroarch:${id}`;
      return new Item({
        id: compoundId,
        source: 'retroarch',
        localId: id,
        title: cfg.label,
        type: 'console',
        metadata: { type: 'console', gameCount, menuStyle: cfg.menuStyle },
        actions: { list: { contentId: compoundId } }
      });
    });
  }

  #listGames(consoleId) {
    const games = this.#catalog.games?.[consoleId] || [];
    const consoleConfig = this.#config.consoles?.[consoleId];
    if (!consoleConfig) return [];

    return games
      .filter(game => {
        const overrides = this.#catalog.overrides?.[`${consoleId}/${game.id}`] || {};
        return !overrides.hidden;
      })
      .map(game => {
        const overrides = this.#catalog.overrides?.[`${consoleId}/${game.id}`] || {};
        const compoundId = `retroarch:${consoleId}/${game.id}`;
        return new Item({
          id: compoundId,
          source: 'retroarch',
          localId: `${consoleId}/${game.id}`,
          title: overrides.title || game.title,
          type: 'game',
          thumbnail: game.thumbnail ? `/api/v1/proxy/retroarch/thumbnail/${game.thumbnail}` : null,
          metadata: { type: 'game', console: consoleId, parentTitle: consoleConfig.label },
          actions: { launch: { contentId: compoundId } }
        });
      });
  }

  #parseLocalId(localId) {
    if (!localId) return { consoleId: null, gameId: null };

    const slashIdx = localId.indexOf('/');
    if (slashIdx >= 0) {
      return { consoleId: localId.slice(0, slashIdx), gameId: localId.slice(slashIdx + 1) };
    }

    for (const [consoleId, games] of Object.entries(this.#catalog.games || {})) {
      if (games.some(g => g.id === localId)) {
        return { consoleId, gameId: localId };
      }
    }

    this.#logger.warn?.('retroarch.item.notFound', { localId });
    return { consoleId: null, gameId: null };
  }
}

export default RetroArchAdapter;
