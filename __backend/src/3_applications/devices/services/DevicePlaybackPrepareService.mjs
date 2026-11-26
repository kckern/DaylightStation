/**
 * DevicePlaybackPrepareService — warm what can be warmed while a person is
 * still LOOKING at an item (Media app info view), so PLAY starts faster.
 *
 * Pure server-side work, and deliberately less than WakeAndLoad's `prewarm`
 * step: TranscodePrewarmService resolves the queue and asks Plex for the
 * playback decision, with `startTranscoder: false`, so it never fetches the
 * stream manifest. That matters: every playback URL carries its own Plex
 * session, so a transcoder started here could never be the one PLAY uses — it
 * would run for nobody. Nothing is powered, woken, loaded or commanded (no
 * device gateway at all, only the device CONFIGURATION, to refuse an id that
 * is not a screen), and nothing is recorded (history, progress, session).
 *
 * At most one prepare is in flight per screen: a call for the same item joins
 * it, a call for another item is skipped (`status: 'busy'`) rather than
 * stacking requests on a Plex that serializes them.
 *
 * @module applications/devices/services
 */
export class DevicePlaybackPrepareService {
  #prewarm; #configuration; #clock; #logger;
  /** @type {Map<string, {contentId: string, promise: Promise<object>}>} */
  #inFlight = new Map();

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
    const running = this.#inFlight.get(deviceId);
    if (running) {
      if (running.contentId === contentId) return running.promise;
      this.#logger.debug?.('device.prepare.busy', { deviceId, contentId, preparing: running.contentId });
      return { kind: 'prepared', status: 'busy', contentId: null, ms: 0 };
    }
    const promise = this.#run(deviceId, contentId)
      .finally(() => { if (this.#inFlight.get(deviceId)?.promise === promise) this.#inFlight.delete(deviceId); });
    this.#inFlight.set(deviceId, { contentId, promise });
    return promise;
  }

  async #run(deviceId, contentId) {
    const started = this.#clock.now();
    const result = await this.#prewarm.prewarm(contentId, { shuffle: false, startTranscoder: false });
    const ms = this.#clock.now() - started;
    const status = typeof result?.status === 'string' ? result.status : 'unknown';
    this.#logger.info?.('device.prepare.done', { deviceId, contentId, status, ms });
    return { kind: 'prepared', status, contentId: status === 'ok' ? (result.contentId ?? null) : null, ms };
  }
}

export default DevicePlaybackPrepareService;
