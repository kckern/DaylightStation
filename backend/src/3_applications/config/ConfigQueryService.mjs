const PLAYER_DEFAULTS = Object.freeze({ preempt_seconds: 15, displace_to_queue: false });

export class ConfigQueryService {
  #loadContentPrefixes;
  #loadPlayerConfig;
  #logger;

  constructor({ loadContentPrefixes, loadPlayerConfig, logger = console }) {
    this.#loadContentPrefixes = loadContentPrefixes;
    this.#loadPlayerConfig = loadPlayerConfig;
    this.#logger = logger;
  }

  getContentPrefixes() {
    try { return this.#loadContentPrefixes() || { legacy: {} }; }
    catch (error) {
      this.#logger.error?.('config.content-prefixes.error', { error: error.message });
      return { legacy: {} };
    }
  }

  getPlayerConfig() {
    let raw;
    try { raw = this.#loadPlayerConfig(); }
    catch (error) {
      this.#logger.warn?.('config.player.load-failed', { error });
      return { on_deck: { ...PLAYER_DEFAULTS } };
    }
    const value = raw?.on_deck ?? {};
    const numeric = Number(value.preempt_seconds);
    const preempt_seconds = value.preempt_seconds !== undefined && Number.isFinite(numeric)
      ? Math.min(600, Math.max(0, numeric)) : PLAYER_DEFAULTS.preempt_seconds;
    const displace_to_queue = typeof value.displace_to_queue === 'boolean'
      ? value.displace_to_queue : PLAYER_DEFAULTS.displace_to_queue;
    return { on_deck: { preempt_seconds, displace_to_queue } };
  }
}

export default ConfigQueryService;
