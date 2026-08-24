import { describe, expect, it, vi } from 'vitest';
import { compileAssessmentExpectation, createAssessmentAttempt } from './assessmentAttempt.js';
import { createAssessmentRuntime } from './assessmentRuntime.js';

const makeAttempt = () => createAssessmentAttempt({ expectation: compileAssessmentExpectation({ events: [{ notes: [{ midi: 60, part: 'rh' }] }] }) });

describe('assessment runtime', () => {
  it('binds input, publishes snapshots, resets, and disposes subscriptions', () => {
    let listener;
    const unsubscribe = vi.fn();
    const runtime = createAssessmentRuntime({ attempt: makeAttempt(), now: () => 10, tickMs: 0, subscribeMidi: (next) => { listener = next; return unsubscribe; } });
    const changed = vi.fn();
    runtime.subscribe(changed);
    runtime.start();
    listener({ midi: 60, time: 20 });
    expect(runtime.getSnapshot().status).toBe('completed');
    expect(changed).toHaveBeenCalled();
    runtime.reset({ attempt: makeAttempt() });
    expect(unsubscribe).toHaveBeenCalled();
    expect(runtime.getSnapshot().status).toBe('prepared');
    runtime.dispose();
  });

  it('keeps interrupted attempts unscored', () => {
    const runtime = createAssessmentRuntime({ attempt: makeAttempt(), now: () => 10, tickMs: 0 });
    runtime.start();
    runtime.abort();
    expect(runtime.getSnapshot().result).toMatchObject({ status: 'aborted', diagnostics: { matched_notes: 0 } });
    expect(runtime.getSnapshot().result).not.toHaveProperty('score');
  });
});
