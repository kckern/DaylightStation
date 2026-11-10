/**
 * The dated rung-promotion log: `users/{id}/apps/piano/rung-log.yml`.
 *
 *   schema: piano.rung-log/v1
 *   entries:
 *     - { at: ISO, game: checkers, ladder: match|addressing, from: 3, to: 4 }
 *
 * Append-only by contract: nothing rewrites or removes an entry. The ladders
 * themselves keep only their current `unlocked_through`, with no date, so this
 * file is the only record of WHEN a rung was reached.
 * See __docs/reference/piano/piano-game-platform.md (Rung log).
 */
const RUNG_LOG_PATH = 'apps/piano/rung-log';
export const RUNG_LOG_SCHEMA = 'piano.rung-log/v1';

export class DataServicePianoRungLogStore {
  #dataService;

  constructor({ dataService }) {
    if (!dataService?.user) throw new Error('DataServicePianoRungLogStore requires dataService');
    this.#dataService = dataService;
  }

  list(userId) {
    const stored = this.#dataService.user.read(RUNG_LOG_PATH, userId);
    return Array.isArray(stored?.entries) ? stored.entries : [];
  }

  /** @returns {boolean} whether the write landed */
  append(userId, entry) {
    const entries = this.list(userId);
    return this.#dataService.user.write(RUNG_LOG_PATH, { schema: RUNG_LOG_SCHEMA, entries: [...entries, entry] }, userId) !== false;
  }
}

export default DataServicePianoRungLogStore;
