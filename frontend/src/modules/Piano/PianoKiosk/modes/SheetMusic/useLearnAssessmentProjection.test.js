import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  compileAssessmentExpectation,
  createAssessmentAttempt,
  createAssessmentRuntime,
} from '../../../performance/assessmentSession.js';
import { useLearnAssessmentProjection } from './useLearnAssessmentProjection.js';

describe('Learn assessment projection', () => {
  it('projects burst input from the canonical cursor even before React commits a step update', () => {
    let receive;
    let now = 0;
    const expectation = compileAssessmentExpectation({
      source: { kind: 'score', id: 'burst' },
      events: [60, 62, 64].map((midi, index) => ({
        id: `event-${index}`,
        onsetQuarter: index,
        notes: [{ midi, part: 'rh' }],
      })),
    });
    const runtime = createAssessmentRuntime({
      attempt: createAssessmentAttempt({ expectation, matcher: 'cursor', clock: 'score-learn' }),
      now: () => now,
      tickMs: 0,
    });
    runtime.start({ time: 0, clock: 'score-learn' });
    const onStep = vi.fn();
    const onComplete = vi.fn();
    const onHit = vi.fn();

    renderHook(() => useLearnAssessmentProjection({
      enabled: true,
      runtimeRef: { current: runtime },
      steps: [0, 1, 2].map((onsetQuarter) => ({ onsetQuarter, notes: [{ midi: 60 + onsetQuarter * 2, staff: 0 }] })),
      activeParts: { 0: true },
      step: 0,
      subscribe: (listener) => { receive = listener; return () => {}; },
      onStep,
      onHit,
      onWrong: vi.fn(),
      onComplete,
      onWrap: vi.fn(),
      now: () => ++now,
    }));

    act(() => {
      receive({ type: 'note_on', note: 60, velocity: 100 });
      receive({ type: 'note_on', note: 62, velocity: 100 });
      receive({ type: 'note_on', note: 64, velocity: 100 });
    });

    expect(onStep.mock.calls.map(([step]) => step)).toEqual([1, 2]);
    expect(onHit).toHaveBeenCalledTimes(3);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(runtime.getSnapshot().status).toBe('completed');
  });
});
