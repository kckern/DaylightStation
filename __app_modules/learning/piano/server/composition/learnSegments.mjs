import { approvedSegments } from '../../portable/music/sheetMusicLearnFile.mjs';

/**
 * `learnSegments(scoreId, contentSha256)`: a score's admin-approved Learn
 * segments, for the background readers (home strip, Polish reward) that follow
 * them. A Learn file cut against different XML than the child practised is
 * ignored. An unreadable file answers null and warns, so those readers fall
 * back to the passages saved on the practice record rather than fail.
 */
export function createLearnSegmentsReader({ datastore, logger = null }) {
  return (scoreId, contentSha256) => {
    if (!scoreId || typeof contentSha256 !== 'string' || !contentSha256) return null;
    try {
      return approvedSegments(datastore.getSheetMusicLearn(scoreId), contentSha256);
    } catch (error) {
      logger?.warn?.('piano.sheetmusic.learn-read-failed', { scoreId, error: error?.message ?? String(error) });
      return null;
    }
  };
}

export default createLearnSegmentsReader;
