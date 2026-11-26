// __backend/src/3_applications/devices/services/TranscodePrewarmService.mjs

const TOKEN_TTL_MS = 60_000;
// How long an info-view prepare (startTranscoder: false) is kept for PLAY to
// reuse. Short on purpose: the decided URL carries the resume offset of the
// moment it was decided, and a look older than this is not a look anymore.
export const PREPARED_TTL_MS = 2 * 60_000;
// 500-id cap is fine: the device snapshot queue is uncapped, so queue-overlap
// confirmation still lands on any id within the first 500.
const MAX_QUEUE_CONTENT_IDS = 500;
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
  /**
   * Info-view prepares, by (deviceId, contentRef, shuffle), for PLAY to reuse.
   * Each entry is the decided playback of the queue's first item: the queue
   * ids, the first item's id and its decided URL (a Plex session of its own,
   * no transcoder started). Taken once: the PLAY that reuses it starts the
   * transcoder on that very URL, so a second PLAY must decide afresh.
   * @type {Map<string, {contentId: string, url: string, queueContentIds: string[], ms: number, expiresAt: number}>}
   */
  #prepared = new Map();

  constructor({ contentIdResolver, contentCatalog, queueService, httpClient, clock, createToken, scheduler, logger = console }) {
    if (!contentIdResolver?.resolve || !contentCatalog?.resolvePlayables
      || !contentCatalog?.preparePlayback || !queueService?.resolveQueue || !httpClient?.get) {
      throw new Error('TranscodePrewarmService requires contentIdResolver, contentCatalog, queueService, and httpClient');
    }
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
    const started = this.#clock.now();
    const preparing = opts.startTranscoder === false;
    const preparedKey = this.#preparedKey(opts.deviceId, contentRef, opts.shuffle);
    if (!preparing && preparedKey) {
      const reused = this.#takePrepared(preparedKey);
      if (reused) return this.#startFromPrepared(contentRef, opts.deviceId, reused);
    }
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

      // Every concrete id of the resolved queue: the wake-and-load playback
      // watchdog confirms a queue/program dispatch against these, because the
      // screen reports the item it plays — never the program id.
      const queueContentIds = [...new Set(items.slice(0, MAX_QUEUE_CONTENT_IDS)
        .map((item) => item?.id).filter((id) => typeof id === 'string' && id))];

      const first = items[0];
      const startOffset = first.resumePosition || first.playhead || 0;
      const prepared = await this.#contentCatalog.preparePlayback(resolved, first, { startOffset });
      if (prepared.kind === 'unsupported') {
        this.#logger.debug?.('prewarm.skip', { contentRef, reason: prepared.reason, source: first.source });
        return { status: 'skipped', reason: prepared.reason, queueContentIds };
      }

      if (prepared.kind === 'failed') {
        const { reason, permanent } = prepared;
        this.#logger.warn?.('prewarm.failed', { contentRef, reason, permanent });
        return { status: 'failed', reason, permanent, queueContentIds };
      }
      const dashUrl = prepared.url;

      // `startTranscoder: false` (info-view prepare): the queue and the
      // playback decision are warm, but no transcoder is started and no token
      // is minted — the URL carries a session of its own, so a transcoder
      // started here would be one nobody plays.
      if (preparing) {
        this.#logger.info?.('prewarm.decided', { contentRef, contentId: first.id });
        if (preparedKey) {
          this.#prepared.set(preparedKey, {
            contentId: first.id, url: dashUrl, queueContentIds,
            ms: this.#clock.now() - started, expiresAt: this.#clock.now() + PREPARED_TTL_MS,
          });
          this.#scheduler.after(PREPARED_TTL_MS + 1000, () => {
            const entry = this.#prepared.get(preparedKey);
            if (entry && this.#clock.now() > entry.expiresAt) this.#prepared.delete(preparedKey);
          });
        }
        return { status: 'ok', token: null, contentId: first.id, queueContentIds, transcoder: false };
      }

      this.#fetchMpd(dashUrl).catch(err => {
        this.#logger.debug?.('prewarm.mpd-fetch-failed', { error: err.message });
      });

      const token = this.#createToken();
      const contentId = first.id;
      this.#cache.set(token, { url: dashUrl, contentId, expiresAt: this.#clock.now() + TOKEN_TTL_MS });
      this.#scheduleCleanup(token);

      this.#logger.info?.('prewarm.success', { contentRef, contentId, token });
      return { status: 'ok', token, contentId, queueContentIds };
    } catch (err) {
      this.#logger.warn?.('prewarm.error', { contentRef, error: err.message });
      return { status: 'failed', reason: 'exception', error: err.message };
    }
  }

  #preparedKey(deviceId, contentRef, shuffle) {
    if (typeof deviceId !== 'string' || !deviceId || typeof contentRef !== 'string' || !contentRef) return null;
    return `${deviceId}\u0000${contentRef}\u0000${shuffle ? 1 : 0}`;
  }

  #takePrepared(key) {
    const entry = this.#prepared.get(key);
    if (!entry) return null;
    this.#prepared.delete(key);
    if (this.#clock.now() > entry.expiresAt) {
      this.#logger.debug?.('prewarm.prepared-expired', { contentId: entry.contentId });
      return null;
    }
    return entry;
  }

  // PLAY after a look: the queue and Plex's decision are already done, so only
  // the transcoder start (MPD fetch on the decided URL) and the token remain.
  #startFromPrepared(contentRef, deviceId, entry) {
    const { url, contentId, queueContentIds, ms } = entry;
    this.#fetchMpd(url).catch(err => {
      this.#logger.debug?.('prewarm.mpd-fetch-failed', { error: err.message });
    });
    const token = this.#createToken();
    this.#cache.set(token, { url, contentId, expiresAt: this.#clock.now() + TOKEN_TTL_MS });
    this.#scheduleCleanup(token);
    this.#logger.info?.('play.prepared-reused', { deviceId, contentRef, contentId, savedMs: ms });
    return { status: 'ok', token, contentId, queueContentIds, reused: true };
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
