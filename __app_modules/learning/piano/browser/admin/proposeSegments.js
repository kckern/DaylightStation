/**
 * "Propose segments" on the admin score page: phrase features per barline from the
 * kiosk's own engraving, the heuristic boundary p for each, and a partition into
 * segments a, b, c… for the editor. Nothing here saves; the proposal rides along
 * with the draft when a grown-up clicks Save draft.
 */
import {
  barlineFeatures, boundaryProbabilities, compactFeatures, FEATURE_KEYS, partitionSegments,
} from '../../portable/music/phraseSegments.mjs';
import { idForIndex } from './segmentEditor.js';
import { householdLearnConfig } from './scorePlan.js';

export const PROPOSAL_LIMITS = Object.freeze({ minLen: 2, maxLen: 8 });

const positiveWhole = (v) => Number.isInteger(v) && v > 0;

/** Household `sheetmusic.learn.passages.targetMeasures`, else 4. */
export function proposalTargetLen(pianoConfig) {
  const target = householdLearnConfig(pianoConfig)?.passages?.targetMeasures;
  return positiveWhole(target) ? target : 4;
}

/** Quarter-note beats per bar from a parsed time signature (6/8 → 3); 4 when unknown. */
export function quartersPerMeasure(timeSig) {
  const beats = Number(timeSig?.beats);
  const beatType = Number(timeSig?.beatType);
  if (!(beats > 0) || !(beatType > 0)) return 4;
  return (beats * 4) / beatType;
}

/**
 * The piece's opening time signature from a parseMusicXml result (its `timeSig` is
 * the last one read, which is wrong for a piece that changes meter).
 */
export function firstTimeSig(parsed) {
  const first = parsed?.parts?.[0]?.measures?.find((m) => m?.attributes?.time)?.attributes?.time;
  return first || parsed?.timeSig;
}

/** A segment list's cuts, ignoring ids and names: renames do not change it. */
export const cutsKey = (segments) => JSON.stringify((segments || []).map((s) => [s.start, s.end]).sort((a, b) => a[0] - b[0] || a[1] - b[1]));

const round3 = (p) => Math.round(p * 1000) / 1000;

/** barlineFeatures records for an engraved score (the page's `score` shape). */
export function scoreFeatures(score) {
  return barlineFeatures({
    measures: score?.measures || [], steps: score?.steps || [], sections: score?.sections || [],
    beatsPerMeasure: score?.beatsPerMeasure, measureMap: score?.measureMap,
  });
}

/**
 * The features as a draft stores them, for calibration: every draft carries them,
 * hand-made ones included, so the calibration CLI can re-score the cuts offline.
 */
export function featureSnapshot(records, beatsPerMeasure) {
  return {
    beatsPerMeasure: Number.isFinite(beatsPerMeasure) ? beatsPerMeasure : 4,
    featureKeys: [...FEATURE_KEYS],
    features: compactFeatures(records),
  };
}

/**
 * @param {{ measures: Array, steps: Array, sections?: Array, beatsPerMeasure?: number, measureMap?: Array }} score
 *   `measureMap` is the score's bar starts and lengths (osmdRender's extractMeasureMap);
 *   `beatsPerMeasure` (quarters) covers bars it misses.
 * @param {{ targetLen?: number, now?: () => string }} [opts]
 * @returns {{ segments: Array<{id,start,end}>, proposal: object }}
 */
export function proposeSegments(score, { targetLen = 4, now = () => new Date().toISOString() } = {}) {
  const measures = score?.measures || [];
  const features = scoreFeatures(score);
  const pAfter = boundaryProbabilities(features);
  const segments = partitionSegments(measures.length, pAfter, { ...PROPOSAL_LIMITS, targetLen })
    .map((s, i) => ({ id: idForIndex(i), start: s.start, end: s.end }));
  const boundaries = Object.fromEntries([...pAfter].map(([k, p]) => [k, round3(p)]));
  return {
    segments,
    proposal: {
      scorer: 'heuristic',
      model: null,
      at: now(),
      boundaries,
      ...featureSnapshot(features, score?.beatsPerMeasure),
    },
  };
}
