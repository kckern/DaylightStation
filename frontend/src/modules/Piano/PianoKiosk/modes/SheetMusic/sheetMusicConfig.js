/**
 * sheetMusicConfig — resolve the raw `sheetmusic:` config (piano.yml) into a
 * fully-defaulted object so mode code can rely on every field. Deep-merges the
 * nested `perform` and `scoring.thresholds` groups; ignores non-object input.
 */
import sha256 from 'crypto-js/sha256.js';

const DEFAULT_LADDER = [
  { id: 'right', label: 'Right hand', parts: ['rh'], mode: 'free', sets: 2, reps: 3, availability: 'sequential', consecutive: false, criteria: { completeness: 1 }, completes: 'rung', legacySeed: 'rh' },
  { id: 'left', label: 'Left hand', parts: ['lh'], mode: 'free', sets: 2, reps: 3, availability: 'sequential', consecutive: false, criteria: { completeness: 1 }, completes: 'rung', legacySeed: 'lh' },
  { id: 'together', label: 'Hands together', parts: ['rh', 'lh'], scope: 'all-parts', mode: 'free', sets: 2, reps: 3, availability: 'sequential', consecutive: false, criteria: { completeness: 1 }, completes: 'rung', legacySeed: 'both' },
  { id: 'timed', label: 'Together with the beat', parts: ['rh', 'lh'], scope: 'all-parts', mode: 'cued', sets: 1, reps: 3, tempoPercent: 60, availability: 'sequential', consecutive: false, criteria: { completeness: 1, cleanliness: 0.8, placement: 0.8 }, completes: 'rung' },
  { id: 'mastery', label: 'Mastery', parts: ['rh', 'lh'], scope: 'all-parts', mode: 'cued', sets: 1, reps: 3, tempoPercent: 100, mastery: true, availability: 'sequential', consecutive: false, criteria: { completeness: 1, cleanliness: 0.8, placement: 0.8 }, completes: 'passage' },
  { id: 'test-out', label: 'Test out', parts: ['rh', 'lh'], scope: 'all-parts', mode: 'cued', sets: 1, reps: 3, tempoPercent: 100, mastery: true, availability: 'always', consecutive: true, criteria: { completeness: 1, cleanliness: 0.8, placement: 0.8 }, completes: 'passage', completion: 'tested-out' },
];

export const SHEET_MUSIC_DEFAULTS = {
  defaultMode: 'listen', // the ladder starts by hearing the piece (audit J2)
  perform: { advancePedalCC: 67, backPedalCC: 66 },
  scoring: { silentMeasuresToStop: 4, timingToleranceMs: 80, thresholds: { green: 0.9, yellow: 0.6 } },
  // Learn hand preference (wave-3 E): household-level fallback when a user has
  // no `learnHands` preference of their own. 'both' keeps today's behavior.
  learn: {
    defaultHands: 'both',
    navigation: { sequential: false },
    passages: { targetMeasures: 4, minMeasures: 3, maxMeasures: 5 },
    tempo: { fallbackBpm: 90, minimumPercent: 15, maximumPercent: 100, adjustable: true },
    feedback: { successReturnMs: 900 },
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
  if (rung.tempoPercent != null && (!Number.isFinite(rung.tempoPercent) || rung.tempoPercent <= 0 || rung.tempoPercent > 100)) return null;
  if (rung.tempoPercents != null && (!Array.isArray(rung.tempoPercents) || !rung.tempoPercents.length
    || rung.tempoPercents.some((value) => !Number.isFinite(value) || value <= 0 || value > 100))) return null;
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
    tempoPercent: rung.mode === 'cued' ? (rung.mastery === true || rung.completion === 'tested-out' ? 100 : rung.tempoPercent ?? 60) : null,
    tempoPercents: rung.mode === 'cued' && Array.isArray(rung.tempoPercents)
      ? (rung.mastery === true || rung.completion === 'tested-out' ? rung.tempoPercents.map(() => 100) : [...rung.tempoPercents])
      : null,
    mastery: rung.mastery === true || rung.completion === 'tested-out',
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
  const rawNavigation = isObj(raw.navigation) ? raw.navigation : {};
  const navigation = { sequential: rawNavigation.sequential === true };
  const rawTempo = isObj(raw.tempo) ? raw.tempo : {};
  const tempo = {
    ...SHEET_MUSIC_DEFAULTS.learn.tempo,
    ...(Number.isFinite(rawTempo.fallbackBpm) && rawTempo.fallbackBpm > 0 ? { fallbackBpm: rawTempo.fallbackBpm } : {}),
    ...(Number.isFinite(rawTempo.minimumPercent) && rawTempo.minimumPercent > 0 && rawTempo.minimumPercent <= 100 ? { minimumPercent: rawTempo.minimumPercent } : {}),
    ...(Number.isFinite(rawTempo.maximumPercent) && rawTempo.maximumPercent > 0 && rawTempo.maximumPercent <= 100 ? { maximumPercent: rawTempo.maximumPercent } : {}),
    ...(typeof rawTempo.adjustable === 'boolean' ? { adjustable: rawTempo.adjustable } : {}),
  };
  if (tempo.minimumPercent > tempo.maximumPercent) tempo.minimumPercent = tempo.maximumPercent;
  const rawFeedback = isObj(raw.feedback) ? raw.feedback : {};
  const feedback = {
    successReturnMs: Number.isInteger(rawFeedback.successReturnMs)
      && rawFeedback.successReturnMs >= 0 && rawFeedback.successReturnMs <= 10000
      ? rawFeedback.successReturnMs : SHEET_MUSIC_DEFAULTS.learn.feedback.successReturnMs,
  };
  // Feedback timing is presentation-only; changing it must not invalidate
  // earned passage/rung progress.
  const behavior = { navigation, passages, tempo, ladder };
  return {
    defaultHands: raw.defaultHands ?? SHEET_MUSIC_DEFAULTS.learn.defaultHands,
    roadmap: raw.roadmap !== false,
    feedback,
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
