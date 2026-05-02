// backend/src/3_applications/devices/services/TranscodePrewarmService.mjs

const TOKEN_TTL_MS = 60_000;
// Keep in sync with the reason union returned by PlexAdapter.loadMediaUrl
// (backend/src/1_adapters/content/media/plex/PlexAdapter.mjs). Reasons NOT
// in this set fall through to permanent:false and trigger FKB URL fallback.
const PERMANENT_REASONS = new Set(['metadata-missing', 'non-playable-type', 'audio-key-missing']);

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
      const isPlex = first.source === 'plex' || first.id?.startsWith('plex:');
      if (!isPlex || !resolved.adapter.loadMediaUrl) {
        this.#logger.debug?.('prewarm.skip', { contentRef, reason: 'not plex', source: first.source });
        return { status: 'skipped', reason: 'not plex' };
      }

      const startOffset = first.resumePosition || first.playhead || 0;
      const mediaResult = await resolved.adapter.loadMediaUrl(first, { startOffset });
      const dashUrl = mediaResult?.url ?? null;
      const failureReason = mediaResult?.reason ?? null;
      if (!dashUrl) {
        const reason = failureReason || 'loadMediaUrl returned null';
        const permanent = !!failureReason && PERMANENT_REASONS.has(failureReason);
        this.#logger.warn?.('prewarm.failed', { contentRef, reason, permanent });
        return { status: 'failed', reason, permanent };
      }

      this.#fetchMpd(dashUrl).catch(err => {
        this.#logger.debug?.('prewarm.mpd-fetch-failed', { error: err.message });
      });

      const token = this.#generateToken();
      const contentId = first.id;
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
