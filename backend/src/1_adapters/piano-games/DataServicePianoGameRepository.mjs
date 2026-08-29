import { deepMerge } from '../../0_system/utils/deepMerge.mjs';
import { IPianoGameRepository } from '#apps/piano-games/ports/IPianoGameRepository.mjs';

const DEFAULT_CONNECT_FOUR_CONFIG = Object.freeze({
  input_mode: 'notes',
  addressing: { vocabulary: 'staff', shuffle: 'never' },
  column_notes: [60, 62, 64, 65, 67, 69, 71],
  column_chords: ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
  default_level: 1,
});
/** Checkers and chess share file/rank instrument axes. */
const DEFAULT_CHECKERS_CONFIG = Object.freeze({
  addressing: { vocabulary: 'staff', shuffle: 'never' },
  file_notes: [60, 62, 64, 65, 67, 69, 71, 72],
  rank_notes: [47, 48, 50, 52, 53, 55, 57, 59],
  default_level: 1,
});

function stamp(record, field) {
  return { ...record, [field]: new Date().toISOString() };
}

export class DataServicePianoGameRepository extends IPianoGameRepository {
  constructor({ dataService, configService }) {
    super();
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
      // Legacy ladders stored bare result strings. Normalize lazily so old
      // progress remains readable by the richer counted-series aggregate.
      series: Array.isArray(stored.series) ? stored.series.map((entry) => (
        typeof entry === 'string' ? { result: entry, counted: true } : entry
      )) : [],
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

  readRivalry(gameId, userId) {
    return this.dataService.user.read(`apps/${gameId}/rivalries`, userId);
  }

  writeRivalry(gameId, userId, memory) {
    return this.dataService.user.write(`apps/${gameId}/rivalries`, memory, userId);
  }

  readLegacyChessRivalry(userId) {
    return this.dataService.user.read('apps/chess/rivalry', userId)
      || this.dataService.user.read('apps/chess/rivalries', userId);
  }
}

export default DataServicePianoGameRepository;
