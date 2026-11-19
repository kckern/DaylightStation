/**
 * Notes the moment a whole piece first becomes all Silver or all Gold, so the
 * gem economy's `piano-piece` milestone can date it. Nothing else can: passage
 * certification is re-derived on every read and has no whole-piece date.
 *
 * A piece and level are noted once. The coach service calls `note()` only when
 * one saved take moved the piece from "not all" to "all" (see
 * PianoLearnCoachService), so legacy credit and re-derived history never
 * reach this file.
 *
 * Best-effort, always: `note()` never throws, because a failed append must
 * never cost a child the take they just saved. A lost append loses that gem;
 * it can never pay twice.
 */
export const PIECE_LEVELS = Object.freeze(['silver', 'gold']);

export class PianoPieceLog {
  #store; #logger; #clock;

  constructor({ store, logger = null, clock = () => new Date() }) {
    if (!store) throw new Error('PianoPieceLog requires a store');
    this.#store = store;
    this.#logger = logger;
    this.#clock = clock;
  }

  /** @returns {object|null} the appended entry, or null when nothing was noted */
  note({ userId, scoreId, level, passages = null, fingerprint = null, at = null } = {}) {
    const base = { userId, scoreId, level };
    try {
      if (!userId || userId === 'guest' || !scoreId || !PIECE_LEVELS.includes(level)) return null;
      if (this.#store.list(String(userId)).some((entry) => entry?.scoreId === scoreId && entry?.level === level)) {
        this.#logger?.info?.('piano.piece-log.already-noted', base);
        return null;
      }
      const entry = { at: at ?? this.#clock().toISOString(), scoreId, level, passages, fingerprint };
      if (this.#store.append(String(userId), entry) === false) throw new Error('write returned false');
      this.#logger?.info?.('piano.piece-log.appended', { ...base, passages });
      return entry;
    } catch (error) {
      this.#logger?.warn?.('piano.piece-log.append-failed', { ...base, error: error?.message ?? String(error) });
      return null;
    }
  }

  /** Every entry for one player, oldest first. Throws if the file cannot be read. */
  list(userId) {
    return this.#store.list(String(userId));
  }
}

export default PianoPieceLog;
