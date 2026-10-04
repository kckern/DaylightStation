/**
 * sheetMusicConfig — resolve the raw `sheetmusic:` config (piano.yml) into a
 * fully-defaulted object so mode code can rely on every field. Deep-merges the
 * nested `perform` and `scoring.thresholds` groups; ignores non-object input.
 */
import sha256 from 'crypto-js/sha256.js';

const DEFAULT_LADDER = [
  { id: 'right', label: 'Right hand', parts: ['rh'], mode: 'free', sets: 2, reps: 3, availability: 'sequential', consecutive: false, criteria: { completeness: 1, cleanliness: 1 }, completes: 'rung', legacySeed: 'rh' },
  { id: 'left', label: 'Left hand', parts: ['lh'], mode: 'free', sets: 2, reps: 3, availability: 'sequential', consecutive: false, criteria: { completeness: 1, cleanliness: 1 }, completes: 'rung', legacySeed: 'lh' },
  { id: 'together', label: 'Hands together', parts: ['rh', 'lh'], scope: 'all-parts', mode: 'free', sets: 2, reps: 3, availability: 'sequential', consecutive: false, criteria: { completeness: 1, cleanliness: 1 }, completes: 'rung', legacySeed: 'both' },
  { id: 'timed', label: 'Together with the beat', parts: ['rh', 'lh'], scope: 'all-parts', mode: 'cued', sets: 1, reps: 3, availability: 'sequential', consecutive: false, criteria: { completeness: 1, cleanliness: 1, placement: 0.8 }, completes: 'passage' },
  { id: 'test-out', label: 'Test out', parts: ['rh', 'lh'], scope: 'all-parts', mode: 'cued', sets: 1, reps: 3, availability: 'always', consecutive: true, criteria: { completeness: 1, cleanliness: 1, placement: 0.8 }, completes: 'passage', completion: 'tested-out' },
];

export const SHEET_MUSIC_DEFAULTS = {
  defaultMode: 'listen', // the ladder starts by hearing the piece (audit J2)
  perform: { advancePedalCC: 67, backPedalCC: 66 },
  scoring: { silentMeasuresToStop: 4, timingToleranceMs: 80, thresholds: { green: 0.9, yellow: 0.6 } },
  // Learn hand preference (wave-3 E): household-level fallback when a user has
  // no `learnHands` preference of their own. 'both' keeps today's behavior.
  learn: {
    defaultHands: 'both',
    passages: { targetMeasures: 4, minMeasures: 3, maxMeasures: 5 },
    ladder: DEFAULT_LADDER,
  },
};

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const positiveWhole = (value) => Number.isInteger(value) && value > 0;

function normalizeRung(rung) {
  if (!isObj(rung) || typeof rung.id !== 'string' || !rung.id.trim() || typeof rung.label !== 'string' || !rung.label.trim()) return null;
  if (!Array.isArray(rung.parts) || !rung.parts.length || rung.parts.some((part) => typeof part !== 'string' || !part.trim())) return null;
  if (!['free', 'metronome', 'cued'].includes(rung.mode) || !positiveWhole(rung.sets) || !positiveWhole(rung.reps)) return null;
  if (rung.availability != null && !['sequential', 'always'].includes(rung.availability)) return null;
  if (rung.completes != null && !['rung', 'passage'].includes(rung.completes)) return null;
  if (rung.completion != null && !['standard', 'tested-out'].includes(rung.completion)) return null;
  if (rung.legacySeed != null && !['rh', 'lh', 'both'].includes(rung.legacySeed)) return null;
  if (rung.scope != null && rung.scope !== 'all-parts') return null;
  if (rung.criteria != null && (!isObj(rung.criteria) || Object.values(rung.criteria).some((value) => !Number.isFinite(value) || value < 0 || value > 1))) return null;
  return {
    ...rung,
    id: rung.id.trim(),
    label: rung.label.trim(),
    parts: [...new Set(rung.parts.map((part) => part.trim()))],
    availability: rung.availability ?? 'sequential',
    consecutive: rung.consecutive === true,
    criteria: { ...(rung.criteria || {}) },
    completes: rung.completes ?? 'rung',
    completion: rung.completion ?? 'standard',
    legacySeed: rung.legacySeed ?? null,
  };
}

function normalizeLearn(rawLearn) {
  const raw = isObj(rawLearn) ? rawLearn : {};
  const rawPassages = isObj(raw.passages) ? raw.passages : {};
  const passages = { ...SHEET_MUSIC_DEFAULTS.learn.passages };
  for (const key of ['targetMeasures', 'minMeasures', 'maxMeasures']) {
    if (positiveWhole(rawPassages[key])) passages[key] = rawPassages[key];
  }
  if (passages.minMeasures > passages.maxMeasures) passages.minMeasures = SHEET_MUSIC_DEFAULTS.learn.passages.minMeasures;
  passages.targetMeasures = Math.max(passages.minMeasures, Math.min(passages.targetMeasures, passages.maxMeasures));

  const hasLadderOverride = Object.prototype.hasOwnProperty.call(raw, 'ladder');
  const requested = Array.isArray(raw.ladder) ? raw.ladder.map(normalizeRung) : null;
  const ids = requested?.filter(Boolean).map((rung) => rung.id) ?? [];
  const configFallback = hasLadderOverride && (
    !requested || requested.length === 0 || requested.some((rung) => !rung) || new Set(ids).size !== ids.length
  );
  const ladder = requested && !configFallback ? requested : DEFAULT_LADDER.map((rung) => normalizeRung(rung));
  const behavior = { passages, ladder };
  return {
    defaultHands: raw.defaultHands ?? SHEET_MUSIC_DEFAULTS.learn.defaultHands,
    roadmap: raw.roadmap !== false,
    ...behavior,
    revision: sha256(JSON.stringify(behavior)).toString(),
    configFallback,
  };
}

export function resolveSheetMusicConfig(raw) {
  const r = isObj(raw) ? raw : {};
  const rScoring = isObj(r.scoring) ? r.scoring : {};
  return {
    defaultMode: r.defaultMode ?? SHEET_MUSIC_DEFAULTS.defaultMode,
    perform: { ...SHEET_MUSIC_DEFAULTS.perform, ...(isObj(r.perform) ? r.perform : {}) },
    scoring: {
      silentMeasuresToStop: rScoring.silentMeasuresToStop ?? SHEET_MUSIC_DEFAULTS.scoring.silentMeasuresToStop,
      timingToleranceMs: rScoring.timingToleranceMs ?? SHEET_MUSIC_DEFAULTS.scoring.timingToleranceMs,
      thresholds: { ...SHEET_MUSIC_DEFAULTS.scoring.thresholds, ...(isObj(rScoring.thresholds) ? rScoring.thresholds : {}) },
    },
    learn: normalizeLearn(r.learn),
  };
}

export default { resolveSheetMusicConfig, SHEET_MUSIC_DEFAULTS };
