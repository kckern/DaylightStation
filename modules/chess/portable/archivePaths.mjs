/**
 * Where a played game is filed.
 *
 * One constant is imported by the writer and every reader so path ownership
 * remains explicit and cannot drift between applications.
 *
 * Relative to the household data root, which is what `dataService.household`
 * and `getHouseholdDir` both resolve — this deliberately does not know where
 * that root is.
 */
export const CHESS_ARCHIVE_DIR = 'gaming/log/chess';

/** The directory a game played on `day` (YYYY-MM-DD) is filed under. */
export function chessArchiveDayDir(day) {
  return `${CHESS_ARCHIVE_DIR}/${day}`;
}

export default { CHESS_ARCHIVE_DIR, chessArchiveDayDir };
