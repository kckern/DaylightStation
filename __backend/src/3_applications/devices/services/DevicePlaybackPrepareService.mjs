/**
 * DevicePlaybackPrepareService — warm a screen's start while a person is still
 * LOOKING at an item (Media app info view), so PLAY starts faster.
 *
 * Pure server-side work: it runs only the transcode prewarm that
 * WakeAndLoadService's `prewarm` step runs (resolve the queue, make the
 * playback decision, fetch the MPD so the transcoder spins up). It never
 * powers, wakes, loads or commands a screen — it has no device gateway at all,
 * only the device CONFIGURATION, to refuse an id that is not a screen. It
 * records no history, progress or session; the prewarm token it mints simply
 * expires unredeemed. The later PLAY prewarms again and finds the transcode
 * (and Plex's decision) already warm.
 *
 * @module applications/devices/services
 */
export class DevicePlaybackPrepareService {
  #prewarm; #configuration; #clock; #logger;

  constructor({ prewarm = null, configuration, clock = Date, logger = console } = {}) {
    this.#prewarm = prewarm?.prewarm ? prewarm : null;
    this.#configuration = configuration;
    this.#clock = clock;
    this.#logger = logger;
  }

  configured() { return !!this.#prewarm; }

  /**
   * @param {string} deviceId
   * @param {string} contentId
   * @returns {Promise<{kind:'not_found'}|{kind:'prepared', status:string, contentId:string|null, ms:number}>}
   */
  async prepare(deviceId, contentId) {
    if (!this.#configuration?.device?.(deviceId)) return { kind: 'not_found' };
    // A camera is a live feed, not catalog content (as in WakeAndLoad).
    if (!this.#prewarm || String(contentId).startsWith('camera:')) {
      return { kind: 'prepared', status: 'skipped', contentId: null, ms: 0 };
    }
    const started = this.#clock.now();
    const result = await this.#prewarm.prewarm(contentId, { shuffle: false });
    const ms = this.#clock.now() - started;
    const status = typeof result?.status === 'string' ? result.status : 'unknown';
    this.#logger.info?.('device.prepare.done', { deviceId, contentId, status, ms });
    return { kind: 'prepared', status, contentId: status === 'ok' ? (result.contentId ?? null) : null, ms };
  }
}

export default DevicePlaybackPrepareService;
