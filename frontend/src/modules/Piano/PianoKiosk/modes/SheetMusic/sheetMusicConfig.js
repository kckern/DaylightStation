/**
 * sheetMusicConfig — resolve the raw `sheetmusic:` config (piano.yml) into a
 * fully-defaulted object so mode code can rely on every field. Deep-merges the
 * nested `perform` and `scoring.thresholds` groups; ignores non-object input.
 */
export const SHEET_MUSIC_DEFAULTS = {
  defaultMode: 'learn',
  perform: { advancePedalCC: 67, backPedalCC: 66 },
  scoring: { silentMeasuresToStop: 4, timingToleranceMs: 80, thresholds: { green: 0.9, yellow: 0.6 } },
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
  };
}

export default { resolveSheetMusicConfig, SHEET_MUSIC_DEFAULTS };
