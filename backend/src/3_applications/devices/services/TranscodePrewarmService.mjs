// backend/src/3_applications/devices/services/TranscodePrewarmService.mjs

const TOKEN_TTL_MS = 60_000;

export class TranscodePrewarmService {
  #contentIdResolver;
  #queueService;
  #httpClient;
  #logger;
  #cache = new Map();

  constructor({ contentIdResolver, queueService, httpClient, logger = console }) {
    this.#contentIdResolver = contentIdResolver;
    this.#queueService = queueService;
    this.#httpClient = httpClient;
    this.#logger = logger;
  }

  async prewarm(contentRef, opts = {}) {
    try {
      const resolved = this.#contentIdResolver.resolve(contentRef);
      if (!resolved?.adapter?.resolvePlayables) {
        this.#logger.debug?.('prewarm.skip', { contentRef, reason: 'no adapter' });
        return { status: 'skipped', reason: 'no adapter' };
      }

      const finalId = `${resolved.source}:${resolved.localId}`;
      const playables = await resolved.adapter.resolvePlayables(finalId);
      const items = await this.#queueService.resolveQueue(
        playables, resolved.source, { shuffle: !!opts.shuffle }
      );

      if (!items?.length) {
        this.#logger.debug?.('prewarm.skip', { contentRef, reason: 'empty queue' });
        return { status: 'skipped', reason: 'empty queue' };
      }

      const first = items[0];
      const isPlex = first.source === 'plex' || first.contentId?.startsWith('plex:');
      if (!isPlex || !resolved.adapter.loadMediaUrl) {
        this.#logger.debug?.('prewarm.skip', { contentRef, reason: 'not plex', source: first.source });
        return { status: 'skipped', reason: 'not plex' };
      }

      const startOffset = first.resumePosition || first.playhead || 0;
      const ratingKey = first.ratingKey || first.contentId?.replace(/^plex:/, '');
      const dashUrl = await resolved.adapter.loadMediaUrl(ratingKey, 0, { startOffset });
      if (!dashUrl) {
        this.#logger.warn?.('prewarm.failed', { contentRef, reason: 'loadMediaUrl returned null' });
        return { status: 'failed', reason: 'loadMediaUrl returned null' };
      }

      this.#fetchMpd(dashUrl).catch(err => {
        this.#logger.debug?.('prewarm.mpd-fetch-failed', { error: err.message });
      });

      const token = this.#generateToken();
      const contentId = first.contentId || `plex:${ratingKey}`;
      this.#cache.set(token, { url: dashUrl, contentId, expiresAt: Date.now() + TOKEN_TTL_MS });
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
    if (Date.now() > entry.expiresAt) {
      this.#cache.delete(token);
      return null;
    }
    this.#cache.delete(token);
    return entry.url;
  }

  async #fetchMpd(dashUrl) {
    await this.#httpClient.get(dashUrl);
  }

  #generateToken() {
    return Math.random().toString(36).substring(2, 10) +
           Math.random().toString(36).substring(2, 10);
  }

  #scheduleCleanup(token) {
    const timer = setTimeout(() => this.#cache.delete(token), TOKEN_TTL_MS + 1000);
    if (timer.unref) timer.unref();
  }
}

export default TranscodePrewarmService;
