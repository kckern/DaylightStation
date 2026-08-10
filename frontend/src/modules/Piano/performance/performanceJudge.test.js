import { describe, expect, it } from 'vitest';
import {
  advancePerformanceRun,
  applyPerformancePress,
  closePerformanceMeasure,
  createPerformanceRun,
} from './performanceJudge.js';

const targets = [
  { id: 1, targetTimeMs: 1000, pitches: [60], measureIndex: 0 },
  { id: 2, targetTimeMs: 1300, pitches: [60], measureIndex: 0 },
  { id: 3, targetTimeMs: 1600, pitches: [64, 67], measureIndex: 1 },
];

describe('performanceJudge', () => {
  it('matches the nearest repeated-pitch attack', () => {
    const { run, event } = applyPerformancePress(createPerformanceRun(targets), 60, 1240);
    expect(run.targets[0].state).toBe('pending');
    expect(run.targets[1].state).toBe('hit');
    expect(event.type).toBe('target_hit');
  });

  it('resolves a chord only after all of its pitches arrive', () => {
    let run = createPerformanceRun(targets);
    let result = applyPerformancePress(run, 64, 1580);
    expect(result.event.type).toBe('target_partial');
    result = applyPerformancePress(result.run, 67, 1640);
    expect(result.run.targets[2]).toMatchObject({ state: 'hit', result: 'perfect' });
  });

  it('reports unmatched notes without consuming a target', () => {
    const { run, event } = applyPerformancePress(createPerformanceRun(targets), 61, 1000, {}, { measureIndex: 0 });
    expect(event).toMatchObject({ type: 'unmatched_note', pitch: 61, measureIndex: 0 });
    expect(run.targets.every((target) => target.state === 'pending')).toBe(true);
  });

  it('expires late targets and can close one measure explicitly', () => {
    let result = advancePerformanceRun(createPerformanceRun(targets), 1500, { missWindowMs: 300 });
    expect(result.run.targets[0].state).toBe('missed');
    expect(result.run.targets[1].state).toBe('pending');
    result = closePerformanceMeasure(result.run, 0, 1600);
    expect(result.run.targets[1].state).toBe('missed');
    expect(result.run.targets[2].state).toBe('pending');
  });
});
