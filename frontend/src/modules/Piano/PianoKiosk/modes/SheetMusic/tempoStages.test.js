import { describe, expect, it } from 'vitest';
import { TEMPO_STAGES, availableTempoStages, nearestTempoStage } from './tempoStages.js';

describe('Learn tempo stages', () => {
  it('offers five directly selectable named percentages', () => {
    expect(TEMPO_STAGES).toEqual([
      { id: 'very-slow', label: 'Very slow', percent: 25 },
      { id: 'slow', label: 'Slow', percent: 40 },
      { id: 'steady', label: 'Steady', percent: 60 },
      { id: 'nearly-there', label: 'Nearly there', percent: 80 },
      { id: 'full-speed', label: 'Full speed', percent: 100 },
    ]);
  });

  it('includes Very slow at the default floor', () => {
    expect(availableTempoStages().map(({ percent }) => percent)).toEqual([25, 40, 60, 80, 100]);
  });

  it('filters stages inclusively to the configured bounds', () => {
    expect(availableTempoStages({ minimumPercent: 40, maximumPercent: 80 }).map(({ percent }) => percent)).toEqual([40, 60, 80]);
    expect(availableTempoStages({ minimumPercent: 55, maximumPercent: 65 }).map(({ percent }) => percent)).toEqual([60]);
  });

  it.each([[25, 'slow'], [59, 'steady'], [75, 'nearly-there'], [100, 'nearly-there']])('maps %s to the nearest available stage %s', (percent, id) => {
    expect(nearestTempoStage(percent, availableTempoStages({ minimumPercent: 40, maximumPercent: 80 })).id).toBe(id);
  });

  it('chooses the slower stage for an equidistant configured percent', () => {
    expect(nearestTempoStage(70, TEMPO_STAGES).id).toBe('steady');
  });

  it('keeps a valid named choice when bounds exclude every standard percentage', () => {
    const stages = availableTempoStages({ minimumPercent: 61, maximumPercent: 65 });
    expect(stages).toEqual([{ id: 'steady', label: 'Steady', percent: 61 }]);
    expect(nearestTempoStage(63, stages)).toEqual({ id: 'steady', label: 'Steady', percent: 61 });
    expect(availableTempoStages({ minimumPercent: 90, maximumPercent: 95 })).toEqual([{ id: 'full-speed', label: 'Full speed', percent: 95 }]);
  });
});
