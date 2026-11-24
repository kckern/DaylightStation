import { describe, expect, it } from 'vitest';
import { TEMPO_STAGES, availableTempoStages, nearestTempoStage, tempoTrackStops } from './tempoStages.js';

describe('Learn tempo stages', () => {
  it('offers Extra slow at 15% as the first directly selectable stage', () => {
    expect(TEMPO_STAGES).toEqual([
      { id: 'extra-slow', label: 'Extra slow', percent: 15 },
      { id: 'very-slow', label: 'Very slow', percent: 25 },
      { id: 'slow', label: 'Slow', percent: 40 },
      { id: 'steady', label: 'Steady', percent: 60 },
      { id: 'nearly-there', label: 'Nearly there', percent: 80 },
      { id: 'full-speed', label: 'Full speed', percent: 100 },
    ]);
  });

  it('includes Extra slow at the default floor', () => {
    expect(availableTempoStages().map(({ percent }) => percent)).toEqual([15, 25, 40, 60, 80, 100]);
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
    expect(availableTempoStages({ minimumPercent: 90, maximumPercent: 95 })).toEqual([{ id: 'nearly-there', label: 'Nearly there', percent: 95 }]);
  });
});

describe('tempoTrackStops (the drill header tempo track)', () => {
  it('takes the ladder from the plan, adds a stop between rungs 20 or more apart, from the floor to 100', () => {
    expect(tempoTrackStops({ ladder: [30, 50, 75, 100], stepPercent: 50 })).toEqual([50, 60, 75, 90, 100]);
    expect(tempoTrackStops({ ladder: [30, 50, 75, 100], stepPercent: 50, floor: 30 })).toEqual([30, 40, 50, 60, 75, 90, 100]);
    // A different ladder (configurable speeds): nothing in the stops assumes the old one.
    expect(tempoTrackStops({ ladder: [50, 70, 85, 100], stepPercent: 100, floor: 50 })).toEqual([50, 60, 70, 85, 100]);
    expect(tempoTrackStops({ ladder: [50, 70, 85, 100], stepPercent: 70 })).toEqual([70, 85, 100]);
  });
  it('always offers the step and 100%, and nothing out of range', () => {
    expect(tempoTrackStops({ ladder: [], stepPercent: 45 })).toEqual([45, 70, 100]);
    expect(tempoTrackStops({ ladder: [0, 120, Number.NaN], stepPercent: 100 })).toEqual([100]);
  });
});
