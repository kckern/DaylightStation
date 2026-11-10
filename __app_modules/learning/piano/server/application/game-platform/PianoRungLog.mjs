/**
 * Notes a rung the moment a ladder raises it, so a rung can later be dated —
 * the gem economy's `piano-rung` milestone reads this, and nothing else could
 * tell it when a promotion happened.
 *
 * Two ladders feed it, for every board game:
 *   - `match`      — the opponent ladder (`ladder.yml` `unlocked_through`)
 *   - `addressing` — the grid-addressing ladder (`config.yml`
 *                    `addressing.ladder.unlocked_through`)
 * Rungs are recorded in the units the game stores (chess's match ladder is
 * zero-based, the rest one-based). Only a RAISE is noted: a demotion, a
 * re-write of the same rung or a first value with nothing before it is not a
 * promotion. A first value above the floor (`from: null`) IS noted — the
 * ladder was absent and is now at a reached rung.
 *
 * Best-effort, always: `note()` never throws, because a failed log append must
 * never cost a child the game or the unlock it just earned.
 */
const LADDERS = new Set(['match', 'addressing']);

export function rungFloor(game, ladder) {
  return game === 'chess' && ladder === 'match' ? 0 : 1;
}

function rungNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export class PianoRungLog {
  #store; #logger; #clock;

  constructor({ store, logger = null, clock = () => new Date() }) {
    if (!store) throw new Error('PianoRungLog requires a store');
    this.#store = store;
    this.#logger = logger;
    this.#clock = clock;
  }

  /**
   * @param {{userId, game, ladder: 'match'|'addressing', from, to}} change
   * @returns {object|null} the appended entry, or null when nothing was noted
   */
  note({ userId, game, ladder, from, to } = {}) {
    try {
      if (!userId || !game || !LADDERS.has(ladder)) return null;
      const before = rungNumber(from) ?? rungFloor(game, ladder);
      const after = rungNumber(to);
      if (after === null || after <= before) return null;
      const entry = { at: this.#clock().toISOString(), game, ladder, from: before, to: after };
      const ok = this.#store.append(String(userId), entry);
      if (!ok) {
        this.#logger?.warn?.('piano.rung-log.append-failed', { userId, game, ladder, from: before, to: after, error: 'write returned false' });
        return null;
      }
      this.#logger?.info?.('piano.rung-log.appended', { userId, game, ladder, from: before, to: after });
      return entry;
    } catch (error) {
      this.#logger?.warn?.('piano.rung-log.append-failed', { userId, game, ladder, from, to, error: error?.message ?? String(error) });
      return null;
    }
  }

  /** Every entry for one player, oldest first. Throws if the file cannot be read. */
  list(userId) {
    return this.#store.list(String(userId));
  }
}

export default PianoRungLog;
