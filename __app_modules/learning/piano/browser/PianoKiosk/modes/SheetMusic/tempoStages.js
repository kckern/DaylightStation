import { SHEET_MUSIC_DEFAULTS } from './sheetMusicConfig.js';

export const TEMPO_STAGES = [
  { id: 'extra-slow', label: 'Extra slow', percent: 15 },
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
  const percent = Math.max(minimumPercent, Math.min(nearest.percent, maximumPercent));
  // Full speed is a promise of 100%, even when a narrow practice interval
  // needs a clamped choice close to the original tempo.
  const identity = nearest.id === 'full-speed' && percent < 100
    ? TEMPO_STAGES.find(({ id }) => id === 'nearly-there') : nearest;
  return [{ ...identity, percent }];
}

const round10 = (value) => Math.round(value / 10) * 10;
/**
 * The stops of the drill header's tempo track, low to high: the ladder's own rung tempos (read from the
 * plan, never assumed), the step's tempo, 100, and one stop halfway between two rungs that are 20 or more
 * apart, so a child can creep up between rungs. Nothing below `floor` (the step's tempo, or lower on the
 * rhythm step only) and nothing above 100.
 */
export function tempoTrackStops({ ladder = [], stepPercent = 100, floor = stepPercent } = {}) {
  const marks = [...new Set([...ladder, stepPercent, 100].map(Number).filter((value) => Number.isFinite(value) && value > 0 && value <= 100))].sort((a, b) => a - b);
  const stops = new Set(marks);
  marks.forEach((value, index) => {
    const next = marks[index + 1];
    if (next != null && next - value >= 20) stops.add(round10((value + next) / 2));
  });
  return [...stops].filter((value) => value >= floor && value <= 100).sort((a, b) => a - b);
}
