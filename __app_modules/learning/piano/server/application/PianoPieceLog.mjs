/**
 * Notes the moment a whole piece first becomes all Silver or all Gold, so the
 * gem economy's `piano-piece` milestone can date it. It also dates a piece's
 * Polish gem and diamond (`polish-gem`, `polish-diamond`; see
 * PianoPolishReward), read by the `piano-polish-gem` and `piano-polish-diamond`
 * milestones. Nothing else can: passage
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
export const PIECE_LEVELS = Object.freeze(['silver', 'gold', 'polish-gem', 'polish-diamond']);
const ENTRY_KEYS = new Set(['at', 'scoreId', 'level', 'passages', 'fingerprint']);

export class PianoPieceLog {
  #store; #logger; #clock;

  constructor({ store, logger = null, clock = () => new Date() }) {
    if (!store) throw new Error('PianoPieceLog requires a store');
    this.#store = store;
    this.#logger = logger;
    this.#clock = clock;
  }

  /** @returns {object|null} the appended entry, or null when nothing was noted */
  note({ userId, scoreId, level, passages = null, fingerprint = null, at = null, detail = null } = {}) {
    const base = { userId, scoreId, level };
    try {
      if (!userId || userId === 'guest' || !scoreId || !PIECE_LEVELS.includes(level)) return null;
      if (this.#store.list(String(userId)).some((entry) => entry?.scoreId === scoreId && entry?.level === level)) {
        this.#logger?.info?.('piano.piece-log.already-noted', base);
        return null;
      }
      // `detail` adds facts about the earning take (a Polish run's tempo and
      // score); it can never overwrite the entry's identity or date.
      const extra = detail && typeof detail === 'object'
        ? Object.fromEntries(Object.entries(detail).filter(([key]) => !ENTRY_KEYS.has(key)))
        : {};
      const entry = { at: at ?? this.#clock().toISOString(), scoreId, level, passages, fingerprint, ...extra };
      if (this.#store.append(String(userId), entry) === false) throw new Error('write returned false');
      this.#logger?.info?.('piano.piece-log.appended', { ...base, passages });
      return entry;
    } catch (error) {
      this.#logger?.warn?.('piano.piece-log.append-failed', { ...base, error: error?.message ?? String(error) });
      return null;
    }
  }

  /** Has this player a `level` entry for the piece? Throws if the file cannot be read. */
  has(userId, scoreId, level) {
    return this.list(userId).some((entry) => entry?.scoreId === scoreId && entry?.level === level);
  }

  /** Every entry for one player, oldest first. Throws if the file cannot be read. */
  list(userId) {
    return this.#store.list(String(userId));
  }
}

export default PianoPieceLog;
