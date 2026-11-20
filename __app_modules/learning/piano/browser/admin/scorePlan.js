/**
 * The kiosk's own Learn plan, computed in the admin so what a grown-up saves agrees
 * with what the kiosk plays. Both helpers run `resolveLearnPlan`, the function the
 * kiosk's ScorePlayer calls, over the same `score: { measures, steps, sections,
 * tempoMap, tempo }` built from the same engraving.
 */
import { resolveLearnPlan } from '../PianoKiosk/modes/SheetMusic/resolveLearnPlan.js';

const toEditorSegment = (s) => ({
  id: s.id,
  start: s.inMeasure,
  end: s.outMeasure,
  ...(typeof s.name === 'string' && s.name ? { name: s.name } : {}),
  ...(Array.isArray(s.playableParts) && s.playableParts.length ? { parts: [...s.playableParts] } : {}),
});

/**
 * The segments the kiosk plays with no approved Learn file: household
 * `sheetmusic.learn` defaults and the piece's own layer, nothing from the score file.
 * `pianoConfig` is the household piano config (`parsed` of the admin apps endpoint);
 * without one the kiosk's built-in defaults apply.
 */
export function generatedSegments({ score, pianoConfig, scoreId }) {
  const learn = pianoConfig?.sheetmusic?.learn;
  const plan = resolveLearnPlan({
    ...(learn && typeof learn === 'object' ? { defaults: learn } : {}),
    piece: learn?.pieces?.[scoreId],
    score,
  });
  return plan.segments.map(toEditorSegment);
}

const bare = ({ id, start, end, name }) => ({ id, start, end, ...(name ? { name } : {}) });

/**
 * Each segment with `parts` set to the hands the kiosk computes for its bars
 * (`playableParts`), so the server's home strip and Polish agree with the kiosk.
 * The kiosk rejects a whole authored list when any segment has no notes to play;
 * those segment ids come back in `missing` and `segments` is null.
 */
export function fillParts(segments, score) {
  const list = Array.isArray(segments) ? segments : [];
  const plan = resolveLearnPlan({ scoreFile: { segments: list.map(bare) }, score });
  if (plan.configFallback) {
    const missing = list
      .filter((s) => resolveLearnPlan({ scoreFile: { segments: [bare(s)] }, score }).configFallback)
      .map((s) => s.id);
    return { segments: null, missing };
  }
  const partsById = new Map(plan.segments.map((s) => [s.id, s.playableParts]));
  return {
    segments: list.map((s) => {
      const out = { ...s };
      const parts = partsById.get(s.id);
      if (Array.isArray(parts) && parts.length) out.parts = [...parts];
      else delete out.parts;
      return out;
    }),
    missing: [],
  };
}
