/**
 * DaylightAndroidVolumeAdapter - hardware audio level for a kiosk panel, via
 * the DaylightStation Android kiosk app (`/volume`).
 *
 * The app owns the stream level on the panel, as Fully did, so the level is
 * set through it. `level` is a percentage the app maps onto the stream's index
 * range, rounding down, which matches Fully: a stored level keeps its meaning
 * when a panel moves from one provider to the other.
 *
 * Stream ids are Android's `AudioManager.STREAM_*` constants; 3 is STREAM_MUSIC.
 *
 * @module adapters/devices
 */
import { IVolumeControl } from '#apps/devices/ports/IVolumeControl.mjs';
import { DaylightAndroidRestClient } from './DaylightAndroidRestClient.mjs';

/** Android AudioManager.STREAM_MUSIC, the one video and music play on. */
const STREAM_MUSIC = 3;

export class DaylightAndroidVolumeAdapter extends IVolumeControl {
  #restClient;
  #stream;
  #logger;

  constructor(config = {}, deps = {}) {
    super();
    if (!deps.httpClient && !deps.restClient) {
      throw new Error('DaylightAndroidVolumeAdapter requires httpClient or restClient');
    }
    this.#stream = Number.isInteger(config.stream) ? config.stream : STREAM_MUSIC;
    this.#logger = deps.logger || console;
    this.#restClient = deps.restClient || new DaylightAndroidRestClient({
      host: config.host,
      port: config.port,
      token: config.token,
    }, { httpClient: deps.httpClient, logger: this.#logger });
  }

  hasVolumeControl() {
    return true;
  }

  get stream() {
    return this.#stream;
  }

  /**
   * @param {number} level - 0..100, a percentage of the stream's index range.
   * @returns {Promise<import('#apps/devices/ports/IVolumeControl.mjs').VolumeControlResult>}
   */
  async setVolume(level) {
    if (!Number.isInteger(level) || level < 0 || level > 100) {
      return { ok: false, error: `Volume level must be an integer 0..100 (got ${String(level)})` };
    }

    const result = await this.#restClient.post('/volume', { level, stream: this.#stream });
    if (!result.ok) {
      this.#logger.warn?.('daylightandroid.volume.set.failed', {
        stream: this.#stream, level, code: result.code, error: result.error,
      });
      return { ok: false, code: result.code, error: result.error || 'volume was rejected' };
    }

    this.#logger.info?.('daylightandroid.volume.set', {
      stream: this.#stream, level, index: result.data?.index, maxIndex: result.data?.maxIndex,
    });
    return { ok: true, level, stream: this.#stream, ...indexes(result.data) };
  }

  /**
   * Read the panel's current level for the configured stream.
   * @returns {Promise<import('#apps/devices/ports/IVolumeControl.mjs').VolumeControlResult>}
   */
  async getVolume() {
    const result = await this.#restClient.get('/volume', { query: { stream: this.#stream } });
    if (!result.ok) {
      return { ok: false, code: result.code, error: result.error || 'volume read was rejected' };
    }
    const level = Number(result.data?.level);
    if (result.data?.level == null || !Number.isFinite(level)) {
      return { ok: false, error: `Device did not report a level for stream ${this.#stream}` };
    }
    return { ok: true, level, stream: this.#stream, ...indexes(result.data) };
  }
}

/** The hardware notch the level landed on, when the device reported it. */
function indexes(data) {
  return {
    ...(Number.isInteger(data?.index) ? { appliedIndex: data.index } : {}),
    ...(Number.isInteger(data?.maxIndex) ? { maxIndex: data.maxIndex } : {}),
  };
}

export default DaylightAndroidVolumeAdapter;
