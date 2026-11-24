/**
 * The coach projection of one practice record: which passages it has, which
 * hands each takes, and what the learner holds on them. The home strip
 * (GetPianoDesk) and the Polish reward (PianoPolishReward) both read it, so
 * they cannot disagree about a piece.
 *
 * Passages are the score's admin-approved Learn segments when the caller has
 * them, otherwise the ones saved on the record. Achievements are keyed by bar
 * range and hands, so unchanged passages keep their progress after a re-cut and
 * changed ones start over, exactly as Learn shows them.
 */
import { createCoachPlan, projectCoach } from '#shared/music/learnCoach.mjs';

export const DEFAULT_PARTS = ['rh', 'lh'];

const isPartList = (parts) => Array.isArray(parts) && parts.length > 0;

/** The passages saved on the record: the coach summary, or an older `learn.segments` plan. */
export function passageRanges(record) {
  const saved = record?.learnCoach?.summary?.passages;
  if (Array.isArray(saved) && saved.length) {
    return saved.filter((passage) => Number.isInteger(passage?.start) && Number.isInteger(passage?.end)).map((passage) => ({
      id: passage.id, inMeasure: passage.start, outMeasure: passage.end,
      playableParts: isPartList(passage.parts) ? passage.parts : DEFAULT_PARTS,
    }));
  }
  const planned = Object.keys(record?.learn?.segments ?? {}).flatMap((id) => {
    const match = /^m(\d+)-(\d+)$/.exec(id);
    return match ? [{ id, inMeasure: Number(match[1]), outMeasure: Number(match[2]) }] : [];
  });
  // Older records do not say which hands a passage has. Two hands is right for
  // nearly the whole library, and the next save stores the real parts.
  return planned.map((passage) => ({ ...passage, playableParts: DEFAULT_PARTS })).sort((x, y) => x.inMeasure - y.inMeasure);
}

const handsKey = (parts) => JSON.stringify([...parts].map(String).sort());

/**
 * The hands an approved segment takes: the ones the admin set on it; else the
 * saved passage on exactly that range; else the one set every saved passage
 * agrees on (a one-hand piece stays one-hand); else both hands.
 */
export function partsForRange(record, segment) {
  if (isPartList(segment?.parts)) return segment.parts;
  const saved = (record?.learnCoach?.summary?.passages ?? []).filter((passage) => isPartList(passage?.parts));
  const same = saved.find((passage) => passage.start === segment?.start && passage.end === segment?.end);
  if (same) return same.parts;
  if (saved.length && saved.every((passage) => handsKey(passage.parts) === handsKey(saved[0].parts))) return saved[0].parts;
  return DEFAULT_PARTS;
}

/** The content sha the child practised. */
export function recordFingerprint(record) {
  return record?.fingerprint?.contentSha256 ?? record?.learnCoach?.fingerprint ?? null;
}

/** Coach segments for a record: the approved ones when given, else those saved on the record. */
export function recordSegments(record, authored = null) {
  return Array.isArray(authored) && authored.length
    ? authored.map((segment) => ({ id: segment.id, inMeasure: segment.start, outMeasure: segment.end, playableParts: partsForRange(record, segment) }))
    : passageRanges(record);
}

export function projectRecord({ record, scoreId, segments, certification, goldLadder, dayKey }) {
  // The coach summary carries the score's opening tempo (written with each coaching event), so the Gold
  // ladder's bpm floor lifts and merges the same rungs here as on the kiosk.
  const bpm = record?.learnCoach?.summary?.baseBpm;
  const tempoMap = Number.isFinite(bpm) && bpm > 0 ? [{ onsetQuarter: 0, bpm }] : [];
  const plan = createCoachPlan({ scoreId, fingerprint: recordFingerprint(record), segments, certification, goldLadder, tempoMap });
  return projectCoach({ plan, state: record?.learnCoach ?? null, legacy: record ?? {}, dayKey });
}
