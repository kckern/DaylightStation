/**
 * sheetMusicConfig — resolve the raw `sheetmusic:` config (piano.yml) into a
 * fully-defaulted object so mode code can rely on every field. Deep-merges the
 * nested `perform` and `scoring.thresholds` groups; ignores non-object input.
 */
export const SHEET_MUSIC_DEFAULTS = {
  defaultMode: 'listen', // the ladder starts by hearing the piece (audit J2)
  perform: { advancePedalCC: 67, backPedalCC: 66 },
  scoring: { silentMeasuresToStop: 4, timingToleranceMs: 80, thresholds: { green: 0.9, yellow: 0.6 } },
  // Learn hand preference (wave-3 E): household-level fallback when a user has
  // no `learnHands` preference of their own. 'both' keeps today's behavior.
  learn: { defaultHands: 'both' },
};

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

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
    learn: { ...SHEET_MUSIC_DEFAULTS.learn, ...(isObj(r.learn) ? r.learn : {}) },
  };
}

export default { resolveSheetMusicConfig, SHEET_MUSIC_DEFAULTS };
