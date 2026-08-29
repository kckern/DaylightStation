import { buildChessArchiveFilename, buildGameRecordFilename } from './ChessRecordNames.mjs';
import { chessArchiveDayDir } from '#shared/gaming/rulesets/chess/archivePaths.mjs';

/** User-scoped game records with their legacy filenames and stored fields. */
export class DataServiceChessGameRecordStore {
  constructor({ dataService, clock }) {
    this.dataService = dataService;
    this.clock = clock;
  }

  save(userId, record) {
    const now = this.clock.now();
    return this.dataService.user.write(
      `apps/chess/games/${buildGameRecordFilename(now)}`,
      { ...record, user_id: userId, created_at: now.toISOString() },
      userId,
    );
  }
}

/** Household archive with its legacy day partition, filename and timestamp. */
export class DataServiceChessArchiveStore {
  constructor({ dataService, clock }) {
    this.dataService = dataService;
    this.clock = clock;
  }

  save(record, userSegment) {
    const now = this.clock.now();
    const day = /^\d{4}-\d{2}-\d{2}$/.test(record.played_on || '')
      ? record.played_on
      : now.toISOString().slice(0, 10);
    return this.dataService.household.write(
      `${chessArchiveDayDir(day)}/${buildChessArchiveFilename(record, userSegment, now)}`,
      { ...record, archived_at: now.toISOString() },
    );
  }
}
