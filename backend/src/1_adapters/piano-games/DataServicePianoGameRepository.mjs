import { deepMerge } from '../../0_system/utils/deepMerge.mjs';

const DEFAULT_CONNECT_FOUR_CONFIG = Object.freeze({
  input_mode: 'notes',
  shuffle_each_game: false,
  column_notes: [60, 62, 64, 65, 67, 69, 71],
  column_chords: ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
  default_level: 1,
});
/**
 * Task 4 redesigned checkers addressing from one unique note per square (32
 * of them) to a file note + a rank note played together — the same scheme
 * chess already uses. The old scheme couldn't grow a truthful axis rail: a
 * rail card is only honest if a whole row or column shares the note it
 * names, and 32 independent notes share nothing. See the frontend's
 * `checkersAddress.js` for the full addressing logic and `normalizeCheckersNotes`
 * for how a client with an OLD persisted config (still carrying `square_notes`,
 * predating this change) falls back to these same defaults instead of
 * breaking. These two axes are deliberately identical to chess's own
 * `DEFAULT_STAFF_SCHEME` (roots=files, qualities=ranks) — one vocabulary, not
 * a third one invented for this game alone.
 */
const DEFAULT_CHECKERS_CONFIG = Object.freeze({
  shuffle_each_game: false,
  file_notes: [60, 62, 64, 65, 67, 69, 71, 72],
  rank_notes: [47, 48, 50, 52, 53, 55, 57, 59],
  default_level: 1,
});

function stamp(record, field) {
  return { ...record, [field]: new Date().toISOString() };
}

export class DataServicePianoGameRepository {
  constructor({ dataService, configService }) {
    this.dataService = dataService;
    this.configService = configService;
  }

  /**
   * The three layers, deep-merged: house defaults, then the household's YAML,
   * then this player's own overrides.
   *
   * DEEP, not shallow. A spread merge replaces a nested block wholesale, so a
   * player who overrode one addressing dimension —
   *   addressing: { x: { tier: 4 } }
   * — silently discarded the household's `vocabulary`, `clefs`, `shuffle` and
   * the other axis, and got defaults for all of them. Every dimension has to be
   * independently overridable at every layer or the layering is decorative.
   * See docs/reference/piano/grid-addressing.md.
   */
  async readConfig(gameId, userId) {
    const household = this.configService.getHouseholdAppConfig(null, gameId) || {};
    const user = userId ? (this.dataService.user.read(`apps/${gameId}/config`, userId) || {}) : {};
    const defaults = gameId === 'connect-four' ? DEFAULT_CONNECT_FOUR_CONFIG
      : gameId === 'checkers' ? DEFAULT_CHECKERS_CONFIG : {};
    return deepMerge(deepMerge(defaults, household), user);
  }

  /**
   * A patch, deep-merged onto what this player already had — so writing one
   * dimension of a nested block leaves its siblings alone. A spread here made
   * `updateConfig({ addressing: { shuffle: 'each_game' } })` erase the player's
   * vocabulary and tiers.
   */
  writeConfig(gameId, userId, config) {
    const path = `apps/${gameId}/config`;
    const current = this.dataService.user.read(path, userId) || {};
    return this.dataService.user.write(path, deepMerge(current, config), userId);
  }

  readProgress(gameId, userId) {
    const stored = this.dataService.user.read(`apps/${gameId}/ladder`, userId);
    if (!stored) return null;
    return {
      unlockedThrough: stored.unlocked_through ?? stored.unlockedThrough,
      series: stored.series,
    };
  }

  writeProgress(gameId, userId, progress) {
    return this.dataService.user.write(`apps/${gameId}/ladder`, {
      unlocked_through: progress.unlockedThrough,
      series: progress.series,
    }, userId);
  }

  saveRecord(gameId, userId, record) {
    return this.dataService.user.write(
      `apps/${gameId}/games/${Date.now()}.yml`, stamp({ ...record, user_id: userId }, 'created_at'), userId,
    );
  }

  saveArchive(gameId, userSegment, record) {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(record.played_on || '')
      ? record.played_on : new Date().toISOString().slice(0, 10);
    return this.dataService.household.write(
      `gaming/log/${gameId}/${day}/${userSegment}-${Date.now()}.yml`, stamp(record, 'archived_at'),
    );
  }
}

export default DataServicePianoGameRepository;
