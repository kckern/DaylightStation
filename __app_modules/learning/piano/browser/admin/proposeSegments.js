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

const round3 = (p) => Math.round(p * 1000) / 1000;

/**
 * @param {{ measures: Array, steps: Array, sections?: Array, beatsPerMeasure?: number }} score
 * @param {{ targetLen?: number, now?: () => string }} [opts]
 * @returns {{ segments: Array<{id,start,end}>, proposal: object }}
 */
export function proposeSegments(score, { targetLen = 4, now = () => new Date().toISOString() } = {}) {
  const measures = score?.measures || [];
  const features = barlineFeatures({
    measures, steps: score?.steps || [], sections: score?.sections || [], beatsPerMeasure: score?.beatsPerMeasure,
  });
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
      featureKeys: [...FEATURE_KEYS],
      features: compactFeatures(features),
    },
  };
}
