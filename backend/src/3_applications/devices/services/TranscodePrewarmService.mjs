// backend/src/3_applications/devices/services/TranscodePrewarmService.mjs

const TOKEN_TTL_MS = 60_000;
export class TranscodePrewarmService {
  #contentIdResolver;
  #contentCatalog;
  #queueService;
  #httpClient;
  #logger;
  #clock;
  #createToken;
  #scheduler;
  #cache = new Map();

  constructor({ contentIdResolver, contentCatalog, queueService, httpClient, clock, createToken, scheduler, logger = console }) {
    if (!clock?.now || typeof createToken !== 'function' || !scheduler?.after) {
      throw new Error('TranscodePrewarmService requires clock, createToken, and scheduler');
    }
    this.#contentIdResolver = contentIdResolver;
    this.#contentCatalog = contentCatalog;
    this.#queueService = queueService;
    this.#httpClient = httpClient;
    this.#logger = logger;
    this.#clock = clock;
    this.#createToken = createToken;
    this.#scheduler = scheduler;
  }

  async prewarm(contentRef, opts = {}) {
    try {
      const resolved = this.#contentIdResolver.resolve(contentRef);
      if (!resolved) {
        this.#logger.debug?.('prewarm.skip', { contentRef, reason: 'no adapter' });
        return { status: 'skipped', reason: 'no adapter' };
      }

      const finalId = `${resolved.source}:${resolved.localId}`;
      const playables = await this.#contentCatalog.resolvePlayables(resolved, finalId);
      if (playables === null) {
        this.#logger.debug?.('prewarm.skip', { contentRef, reason: 'no adapter' });
        return { status: 'skipped', reason: 'no adapter' };
      }
      const items = await this.#queueService.resolveQueue(
        playables, resolved.source, { shuffle: !!opts.shuffle }
      );

      if (!items?.length) {
        this.#logger.debug?.('prewarm.skip', { contentRef, reason: 'empty queue' });
        return { status: 'skipped', reason: 'empty queue' };
      }

      const first = items[0];
      const startOffset = first.resumePosition || first.playhead || 0;
      const prepared = await this.#contentCatalog.preparePlayback(resolved, first, { startOffset });
      if (prepared.kind === 'unsupported') {
        this.#logger.debug?.('prewarm.skip', { contentRef, reason: prepared.reason, source: first.source });
        return { status: 'skipped', reason: prepared.reason };
      }

      if (prepared.kind === 'failed') {
        const { reason, permanent } = prepared;
        this.#logger.warn?.('prewarm.failed', { contentRef, reason, permanent });
        return { status: 'failed', reason, permanent };
      }
      const dashUrl = prepared.url;

      this.#fetchMpd(dashUrl).catch(err => {
        this.#logger.debug?.('prewarm.mpd-fetch-failed', { error: err.message });
      });

      const token = this.#createToken();
      const contentId = first.id;
      this.#cache.set(token, { url: dashUrl, contentId, expiresAt: this.#clock.now() + TOKEN_TTL_MS });
      this.#scheduleCleanup(token);

      this.#logger.info?.('prewarm.success', { contentRef, contentId, token });
      return { status: 'ok', token, contentId };
    } catch (err) {
      this.#logger.warn?.('prewarm.error', { contentRef, error: err.message });
      return { status: 'failed', reason: 'exception', error: err.message };
    }
  }

  redeem(token) {
    const entry = this.#cache.get(token);
    if (!entry) return null;
    if (this.#clock.now() > entry.expiresAt) {
      this.#cache.delete(token);
      return null;
    }
    this.#cache.delete(token);
    return entry.url;
  }

  async #fetchMpd(dashUrl) {
    await this.#httpClient.get(dashUrl);
  }

  #scheduleCleanup(token) {
    this.#scheduler.after(TOKEN_TTL_MS + 1000, () => this.#cache.delete(token));
  }
}

export default TranscodePrewarmService;
