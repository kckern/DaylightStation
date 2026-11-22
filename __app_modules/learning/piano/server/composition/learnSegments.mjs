import { approvedSegments, hasLearnOwnerConflict, normalizeLearnFile, validateSegments } from '../../portable/music/sheetMusicLearnFile.mjs';

const isObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/**
 * `sheetmusic.learn` as the kiosk resolves it: the single configured piano's own
 * `sheetmusic.learn` when it has one (a per-piano `sheetmusic` block is merged
 * shallowly over the shared one, so its `learn` replaces the shared `learn`),
 * else the shared top level. Same rule as the admin's `householdLearnConfig`.
 */
function householdLearn(pianoConfig) {
  if (!isObject(pianoConfig)) return null;
  const pianos = isObject(pianoConfig.pianos) ? pianoConfig.pianos : {};
  const ids = Object.keys(pianos);
  const own = ids.length === 1 ? pianos[ids[0]]?.sheetmusic?.learn : undefined;
  const learn = own ?? pianoConfig.sheetmusic?.learn;
  return isObject(learn) ? learn : null;
}

/**
 * A household `sheetmusic.learn.pieces[scoreId].segments` list as Learn segments
 * (`start`/`end`, or the kiosk's `inMeasure`/`outMeasure`), sorted; `[]` when the
 * list does not validate, `null` when there is no override.
 */
function overrideSegments(pianoConfig, scoreId) {
  const raw = householdLearn(pianoConfig)?.pieces?.[scoreId]?.segments;
  if (!Array.isArray(raw) || !raw.length) return null;
  const segments = raw.map((item) => {
    const out = {
      id: typeof item?.id === 'string' ? item.id.trim() : '',
      start: Number.isInteger(item?.start) ? item.start : item?.inMeasure,
      end: Number.isInteger(item?.end) ? item.end : item?.outMeasure,
    };
    if (typeof item?.name === 'string' && item.name.trim()) out.name = item.name.trim();
    if (Array.isArray(item?.parts) && item.parts.length) out.parts = [...item.parts];
    return out;
  });
  if (validateSegments(segments, Number.MAX_SAFE_INTEGER).length) return [];
  return segments.sort((a, b) => a.start - b.start);
}

/**
 * `learnSegments(scoreId, contentSha256)`: the segments the kiosk teaches for a
 * score, for the background readers (home strip, Polish reward) that follow them.
 * A household `sheetmusic.learn.pieces[scoreId].segments` override wins, as in
 * the kiosk's resolveLearnPlan, with no sha check (it names no XML); one that does
 * not validate answers null and logs `piano.sheetmusic.override-invalid` once.
 * Otherwise the admin-approved Learn file is read. A Learn file cut against different XML than the child practised is
 * ignored without comment. An unreadable file (`piano.sheetmusic.learn-read-failed`)
 * or a matching file whose segments do not validate (`piano.sheetmusic.learn-invalid`)
 * answers null, so those readers fall back to the passages saved on the
 * practice record rather than fail. The desk reads every child's record on each
 * home-screen open, so each warning is logged once per score for the life of
 * this reader (the composition root builds one per process).
 */
export function createLearnSegmentsReader({ datastore, pianoConfig = () => null, logger = null }) {
  const warned = new Set();
  const warnOnce = (event, scoreId, data) => {
    const key = `${event}\u0000${scoreId}`;
    if (warned.has(key)) return;
    warned.add(key);
    logger?.warn?.(event, { scoreId, ...data });
  };
  return (scoreId, contentSha256) => {
    if (!scoreId || typeof contentSha256 !== 'string' || !contentSha256) return null;
    let config = null;
    try { config = pianoConfig(); } catch { config = null; }
    const override = overrideSegments(config, scoreId);
    if (override) {
      if (override.length) return override;
      warnOnce('piano.sheetmusic.override-invalid', scoreId);
      return null;
    }
    let file;
    try {
      file = datastore.getSheetMusicLearn(scoreId);
    } catch (error) {
      warnOnce('piano.sheetmusic.learn-read-failed', scoreId, { error: error?.message ?? String(error) });
      return null;
    }
    if (hasLearnOwnerConflict(file, scoreId)) {
      warnOnce('piano.sheetmusic.learn-owner-conflict', scoreId, { ownerScoreId: file.scoreId });
      return null;
    }
    const segments = approvedSegments(file, contentSha256, scoreId);
    if (!segments && file) {
      const normalized = normalizeLearnFile(file);
      if (normalized.contentSha256 === contentSha256 && normalized.segments.length) warnOnce('piano.sheetmusic.learn-invalid', scoreId);
    }
    return segments;
  };
}

export default createLearnSegmentsReader;
