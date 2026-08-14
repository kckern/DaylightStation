const DEFAULT_CONNECT_FOUR_CONFIG = Object.freeze({
  input_mode: 'notes',
  shuffle_each_game: false,
  column_notes: [60, 62, 64, 65, 67, 69, 71],
  column_chords: ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
  default_level: 1,
});
const DEFAULT_CHECKERS_CONFIG = Object.freeze({
  shuffle_each_game: false,
  square_notes: Array.from({ length: 32 }, (_, index) => 48 + index),
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

  async readConfig(gameId, userId) {
    const household = this.configService.getHouseholdAppConfig(null, gameId) || {};
    const user = userId ? (this.dataService.user.read(`apps/${gameId}/config`, userId) || {}) : {};
    const defaults = gameId === 'connect-four' ? DEFAULT_CONNECT_FOUR_CONFIG
      : gameId === 'checkers' ? DEFAULT_CHECKERS_CONFIG : {};
    return { ...defaults, ...household, ...user };
  }

  writeConfig(gameId, userId, config) {
    const path = `apps/${gameId}/config`;
    const current = this.dataService.user.read(path, userId) || {};
    return this.dataService.user.write(path, { ...current, ...config }, userId);
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
      `history/gaming/${gameId}/${day}/${userSegment}-${Date.now()}.yml`, stamp(record, 'archived_at'),
    );
  }
}

export default DataServicePianoGameRepository;
