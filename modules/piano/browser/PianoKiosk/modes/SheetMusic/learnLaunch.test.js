import { describe, expect, it } from 'vitest';
import {
  buildCustomLaunch,
  buildRungLaunch,
  creditEligibleRung,
  freshRunRung,
  learnLaunchpadProjection,
} from './learnLaunch.js';

const rung = (overrides = {}) => ({
  id: 'right', label: 'Right hand', effectiveParts: ['rh'], mode: 'free',
  sets: 2, reps: 3, required: 6, passCount: 0, state: 'current',
  tempoPercent: null, ...overrides,
});
const segment = (overrides = {}) => ({
  id: 'm0-3', label: 'Segment 1', barLabel: 'Bars 1–4', playableParts: ['rh', 'lh'],
  complete: false, testedOut: false,
  rungs: [rung(), rung({ id: 'left', label: 'Left hand', effectiveParts: ['lh'], state: 'locked' }),
    rung({ id: 'test-out', label: 'Test out', effectiveParts: ['rh', 'lh'], mode: 'cued', sets: 1, reps: 3, required: 3, state: 'available', tempoPercent: 100 })],
  ...overrides,
});

describe('learn launch model', () => {
  it('projects one recommended action while keeping completed drills reviewable', () => {
    const projected = learnLaunchpadProjection(segment({ rungs: [
      rung({ state: 'complete', passCount: 6 }),
      rung({ id: 'left', label: 'Left hand', effectiveParts: ['lh'], state: 'current' }),
      rung({ id: 'test-out', label: 'Test out', effectiveParts: ['rh', 'lh'], mode: 'cued', sets: 1, reps: 3, required: 3, state: 'available', tempoPercent: 100 }),
    ] }));
    expect(projected.recommended.id).toBe('left');
    expect(projected.review.map((item) => item.id)).toEqual(['right', 'left']);
    expect(projected.testOut.id).toBe('test-out');
  });

  it('replays a completed rung with fresh temporary sets and reps', () => {
    const fresh = freshRunRung(rung({ state: 'complete', passCount: 6 }));
    expect(fresh).toMatchObject({ passCount: 0, state: 'current', achievementPassCount: 6, achievementComplete: true });
  });

  it('builds a custom one-run launch and omits impossible hands', () => {
    const launch = buildCustomLaunch(segment({ playableParts: ['rh'] }), { parts: ['rh'], mode: 'metronome', tempoPercent: 60, tempoStage: 'steady' });
    expect(launch).toMatchObject({ source: 'custom', segmentId: 'm0-3', parts: ['rh'], mode: 'metronome', tempoPercent: 60, sets: 1, reps: 1 });
    expect(() => buildCustomLaunch(segment({ playableParts: ['rh'] }), { parts: ['lh'], mode: 'free' })).toThrow(/unavailable/i);
  });

  it('awards optional credit only to an exact unlocked unfinished rung', () => {
    const target = rung({ id: 'timed', effectiveParts: ['rh', 'lh'], mode: 'cued', tempoPercent: 60, state: 'current' });
    const s = segment({ rungs: [target] });
    const exact = buildCustomLaunch(s, { parts: ['lh', 'rh'], mode: 'cued', tempoPercent: 60, tempoStage: 'steady' });
    expect(creditEligibleRung(s, exact)?.id).toBe('timed');
    expect(creditEligibleRung(s, { ...exact, tempoPercent: 80 })).toBeNull();
    expect(creditEligibleRung(segment({ rungs: [{ ...target, state: 'complete', passCount: 6 }] }), exact)).toBeNull();
    expect(creditEligibleRung(segment({ rungs: [{ ...target, state: 'locked' }] }), exact)).toBeNull();
  });

  it('lets an exact Test Out run earn Test Out credit', () => {
    const s = segment();
    const launch = buildRungLaunch(s, s.rungs[2], 'review');
    expect(creditEligibleRung(s, launch)?.id).toBe('test-out');
  });

  it('builds named rung launches with explicit source and fresh run state', () => {
    const launch = buildRungLaunch(segment(), rung({ passCount: 4 }), 'review');
    expect(launch).toMatchObject({ source: 'review', segmentId: 'm0-3', rungId: 'right', parts: ['rh'], mode: 'free' });
    expect(launch.rung).toMatchObject({ passCount: 0, achievementPassCount: 4 });
  });
});
