/**
 * Where a played game is filed.
 *
 * One constant, imported by the writer (the app's `archiveStore`) and by every
 * reader (the review and calibrate CLIs), because they have already drifted
 * apart once: a household reorganisation moved this directory and the CLIs went
 * on reading the old location, reporting "no archived games" for a corpus of
 * thirty-two that were sitting a directory away. A stale path that reads as an
 * empty result is worse than one that throws.
 *
 * Relative to the household data root, which is what `dataService.household`
 * and `getHouseholdDir` both resolve — this deliberately does not know where
 * that root is.
 */
export const CHESS_ARCHIVE_DIR = 'gaming/log/pianochess';

/** The directory a game played on `day` (YYYY-MM-DD) is filed under. */
export function chessArchiveDayDir(day) {
  return `${CHESS_ARCHIVE_DIR}/${day}`;
}

export default { CHESS_ARCHIVE_DIR, chessArchiveDayDir };
