/**
 * FullyKioskVolumeAdapter — hardware audio level for a kiosk panel, via Fully
 * Kiosk's REST API (`cmd=setAudioVolume`).
 *
 * Why through FKB rather than at the OS: FKB re-asserts its stored levels on
 * every media start. Measured on the Portal 2026-09-09, `dumpsys audio` showed
 * `de.ozerov.fully` writing every stream in a burst the moment playback began.
 * Anything that sets the stream from outside FKB is overwritten seconds later.
 * Setting through FKB updates the value FKB re-asserts, which turns the app from
 * an adversary into the enforcement mechanism.
 *
 * Stream ids are Android's `AudioManager.STREAM_*` constants; 3 is STREAM_MUSIC.
 *
 * @module adapters/devices
 */
import { IVolumeControl } from '#apps/devices/ports/IVolumeControl.mjs';
import { FullyKioskRestClient } from './FullyKioskRestClient.mjs';

/** Android AudioManager.STREAM_MUSIC — the one video and music play on. */
const STREAM_MUSIC = 3;

export class FullyKioskVolumeAdapter extends IVolumeControl {
  #restClient;
  #stream;
  #logger;

  constructor(config = {}, deps = {}) {
    super();
    if (!deps.httpClient && !deps.restClient) {
      throw new Error('FullyKioskVolumeAdapter requires httpClient or restClient');
    }
    this.#stream = Number.isInteger(config.stream) ? config.stream : STREAM_MUSIC;
    this.#logger = deps.logger || console;
    this.#restClient = deps.restClient || new FullyKioskRestClient({
      host: config.host,
      port: config.port,
      password: config.password,
    }, { httpClient: deps.httpClient, logger: this.#logger });
  }

  hasVolumeControl() {
    return true;
  }

  get stream() {
    return this.#stream;
  }

  /**
   * @param {number} level - 0..100. FKB takes a percentage and maps it onto the
   *   stream's index range, rounding DOWN — on the Portal that range is 0..18, so
   *   55% lands on index 9 and 56% on index 10. The caller's number is honoured
   *   as a percentage, not as a promise of 100 distinct levels.
   * @returns {Promise<import('#apps/devices/ports/IVolumeControl.mjs').VolumeControlResult>}
   */
  async setVolume(level) {
    if (!Number.isInteger(level) || level < 0 || level > 100) {
      return { ok: false, error: `Volume level must be an integer 0..100 (got ${String(level)})` };
    }

    const result = await this.#restClient.command('setAudioVolume', { level, stream: this.#stream });
    if (!result.ok) {
      this.#logger.warn?.('fullykiosk.volume.set.failed', {
        stream: this.#stream, level, code: result.code, error: result.error,
      });
      return { ok: false, code: result.code, error: result.error || 'setAudioVolume was rejected' };
    }

    this.#logger.info?.('fullykiosk.volume.set', { stream: this.#stream, level });
    return { ok: true, level, stream: this.#stream };
  }

  /**
   * Read the panel's current level for the configured stream.
   * @returns {Promise<import('#apps/devices/ports/IVolumeControl.mjs').VolumeControlResult>}
   */
  async getVolume() {
    const result = await this.#restClient.command('deviceInfo', {});
    if (!result.ok) {
      return { ok: false, code: result.code, error: result.error || 'deviceInfo was rejected' };
    }

    // audioVolumes is a LIST of single-key objects keyed by stream id, in no
    // particular order: [{"4":82},{"8":55},{"3":55}]. Not a map.
    const entries = result.data?.audioVolumes;
    if (!Array.isArray(entries)) {
      return { ok: false, error: 'deviceInfo did not report audioVolumes' };
    }

    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const found = Object.entries(entry).find(([key]) => Number(key) === this.#stream);
      if (found) return { ok: true, level: Number(found[1]), stream: this.#stream };
    }

    return { ok: false, error: `deviceInfo did not report stream ${this.#stream}` };
  }
}

export default FullyKioskVolumeAdapter;
