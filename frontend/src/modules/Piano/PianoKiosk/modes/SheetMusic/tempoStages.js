import { SHEET_MUSIC_DEFAULTS } from './sheetMusicConfig.js';

export const TEMPO_STAGES = [
  { id: 'very-slow', label: 'Very slow', percent: 25 },
  { id: 'slow', label: 'Slow', percent: 40 },
  { id: 'steady', label: 'Steady', percent: 60 },
  { id: 'nearly-there', label: 'Nearly there', percent: 80 },
  { id: 'full-speed', label: 'Full speed', percent: 100 },
];

export function nearestTempoStage(percent, stages = TEMPO_STAGES) {
  return stages.reduce((nearest, stage) => !nearest
    || Math.abs(stage.percent - percent) < Math.abs(nearest.percent - percent) ? stage : nearest, undefined);
}

export function availableTempoStages({
  minimumPercent = SHEET_MUSIC_DEFAULTS.learn.tempo.minimumPercent,
  maximumPercent = SHEET_MUSIC_DEFAULTS.learn.tempo.maximumPercent,
} = {}) {
  const stages = TEMPO_STAGES.filter(({ percent }) => percent >= minimumPercent && percent <= maximumPercent);
  if (stages.length) return stages;
  // A valid narrow interval still needs a direct choice. Keep the nearest
  // stage's identity while clamping its percentage to the allowed interval.
  const midpoint = (minimumPercent + maximumPercent) / 2;
  const nearest = nearestTempoStage(midpoint);
  return [{ ...nearest, percent: Math.max(minimumPercent, Math.min(nearest.percent, maximumPercent)) }];
}
