/**
 * PlayLedgerRecorder — turns the play/log heartbeat stream into one ledger
 * row per playback START per screen.
 *
 * Starts are derived the same way the media-server session reporter derives
 * them: PlaybackSessionRegistry.record() returning `opened` (new screen, or a
 * different item on that screen). This recorder owns its OWN registry, so the
 * ledger does not depend on a media server being configured, and it adds one
 * rule the reporter gets from its sweep timer instead: a screen that has been
 * quiet on an item for longer than `resumeGapMs` (default 15 min) and then
 * reports it again has started it again — "we came back to the film after
 * dinner" is a play.
 *
 * Advisory: a ledger failure is logged and never reaches play/log's caller.
 */
import { PlaybackSessionRegistry } from '#apps/content/runtime/PlaybackSessionRegistry.mjs';
import { buildPlayLedgerRow, selectPlays, PLAY_LEDGER_RETENTION_DAYS } from '#domains/media/playLedger.mjs';

const DEFAULT_RESUME_GAP_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export class PlayLedgerRecorder {
  #store;
  #registry;
  #resumeGapMs;
  #logger;

  /**
   * @param {Object} deps
   * @param {import('./ports/IPlayLedgerDatastore.mjs').IPlayLedgerDatastore} deps.store
   * @param {number} [deps.resumeGapMs]
   */
  constructor({ store, resumeGapMs = DEFAULT_RESUME_GAP_MS, registry = new PlaybackSessionRegistry(), logger = console }) {
    if (!store) throw new TypeError('PlayLedgerRecorder requires store');
    this.#store = store;
    this.#registry = registry;
    this.#resumeGapMs = resumeGapMs;
    this.#logger = logger;
  }

  /**
   * A progress report from a screen.
   * @param {{deviceId:string, contentId:string, atEpoch:number, startedAt:string, localTime:string, metadata?:Object, origin?:string|null}} report
   * @returns {Promise<{opened:boolean, written:boolean}>}
   */
  async observe({ deviceId, contentId, atEpoch, startedAt, localTime, metadata = null, origin = null }) {
    if (!deviceId || !contentId) return { opened: false, written: false };
    const live = this.#registry.get(deviceId);
    if (live && live.contentId === contentId && live.isStale({ now: atEpoch, ttlMs: this.#resumeGapMs })) {
      this.#registry.close({ surfaceId: deviceId, at: atEpoch });
    }
    const { opened } = this.#registry.record({ surfaceId: deviceId, contentId, at: atEpoch });
    if (!opened) return { opened: false, written: false };
    try {
      await this.#store.append(buildPlayLedgerRow({ deviceId, contentId, startedAt, localTime, metadata, origin }));
      this.#logger.info?.('media.play-ledger.started', { deviceId, contentId, origin: origin ?? null });
      return { opened: true, written: true };
    } catch (error) {
      this.#logger.warn?.('media.play-ledger.write_failed', { deviceId, contentId, error: error.message });
      return { opened: true, written: false };
    }
  }

  /**
   * Query the ledger: by device and/or ISO time window, newest first.
   * Defaults to the whole retention window.
   * @param {{deviceId?:string, from?:string, to?:string, limit?:number, nowEpoch?:number}} q
   */
  async plays({ deviceId = null, from = null, to = null, limit = 100, nowEpoch = Date.now() } = {}) {
    const fromIso = from || new Date(nowEpoch - PLAY_LEDGER_RETENTION_DAYS * DAY_MS).toISOString();
    // Day buckets are local; widen by a day each side so a UTC bound never
    // drops a file whose local day straddles it.
    const dayOf = (iso, deltaDays) => {
      const t = Date.parse(iso);
      return Number.isFinite(t) ? new Date(t + deltaDays * DAY_MS).toISOString().slice(0, 10) : null;
    };
    const rows = await this.#store.list({ fromDay: dayOf(fromIso, -1), toDay: to ? dayOf(to, 1) : null });
    return selectPlays(rows, { deviceId, from: fromIso, to, limit });
  }
}

export default PlayLedgerRecorder;
