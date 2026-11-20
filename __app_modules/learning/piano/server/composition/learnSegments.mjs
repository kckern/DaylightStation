import { approvedSegments, normalizeLearnFile } from '../../portable/music/sheetMusicLearnFile.mjs';

/**
 * `learnSegments(scoreId, contentSha256)`: a score's admin-approved Learn
 * segments, for the background readers (home strip, Polish reward) that follow
 * them. A Learn file cut against different XML than the child practised is
 * ignored without comment. An unreadable file (`piano.sheetmusic.learn-read-failed`)
 * or a matching file whose segments do not validate (`piano.sheetmusic.learn-invalid`)
 * answers null, so those readers fall back to the passages saved on the
 * practice record rather than fail. The desk reads every child's record on each
 * home-screen open, so each warning is logged once per score for the life of
 * this reader (the composition root builds one per process).
 */
export function createLearnSegmentsReader({ datastore, logger = null }) {
  const warned = new Set();
  const warnOnce = (event, scoreId, data) => {
    const key = `${event}\u0000${scoreId}`;
    if (warned.has(key)) return;
    warned.add(key);
    logger?.warn?.(event, { scoreId, ...data });
  };
  return (scoreId, contentSha256) => {
    if (!scoreId || typeof contentSha256 !== 'string' || !contentSha256) return null;
    let file;
    try {
      file = datastore.getSheetMusicLearn(scoreId);
    } catch (error) {
      warnOnce('piano.sheetmusic.learn-read-failed', scoreId, { error: error?.message ?? String(error) });
      return null;
    }
    const segments = approvedSegments(file, contentSha256);
    if (!segments && file) {
      const normalized = normalizeLearnFile(file);
      if (normalized.contentSha256 === contentSha256 && normalized.segments.length) warnOnce('piano.sheetmusic.learn-invalid', scoreId);
    }
    return segments;
  };
}

export default createLearnSegmentsReader;
