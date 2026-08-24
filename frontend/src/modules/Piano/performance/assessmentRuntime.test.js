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

  it('does not publish React snapshots for clock ticks that change no state', () => {
    const runtime = createAssessmentRuntime({ attempt: makeAttempt(), now: () => 10, tickMs: 0 });
    const changed = vi.fn();
    runtime.subscribe(changed);
    runtime.start();
    changed.mockClear();
    runtime.tick();
    expect(changed).not.toHaveBeenCalled();
  });

  it('batches non-terminal MIDI changes into low-frequency React snapshots', () => {
    vi.useFakeTimers();
    const attempt = createAssessmentAttempt({
      expectation: compileAssessmentExpectation({
        events: [{ notes: [60, 64, 67, 71].map((midi) => ({ midi, part: 'rh' })) }],
      }),
    });
    const runtime = createAssessmentRuntime({ attempt, now: () => 10, tickMs: 0, snapshotMs: 50 });
    const changed = vi.fn();
    runtime.subscribe(changed);
    runtime.start();
    changed.mockClear();
    runtime.observe({ midi: 60, time: 20 });
    runtime.observe({ midi: 64, time: 21 });
    runtime.observe({ midi: 67, time: 22 });
    expect(changed).not.toHaveBeenCalled();
    expect(runtime.getStoreSnapshot().hits).toEqual({});
    vi.advanceTimersByTime(50);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(Object.keys(runtime.getStoreSnapshot().hits)).toHaveLength(3);
    runtime.dispose();
    vi.useRealTimers();
  });

  it('times out once, disconnects input, and emits one terminal callback', () => {
    const onTerminal = vi.fn();
    const unsubscribe = vi.fn();
    const runtime = createAssessmentRuntime({
      attempt: makeAttempt(), now: () => 10, tickMs: 0,
      subscribeMidi: () => unsubscribe,
      onTerminal,
    });
    runtime.start();
    runtime.timeout();
    runtime.timeout();
    expect(runtime.getSnapshot().result).toMatchObject({ status: 'timeout' });
    expect(runtime.getSnapshot().result).not.toHaveProperty('score');
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(onTerminal).toHaveBeenCalledTimes(1);
  });

  it('publishes a terminal result when an expectation contains only rests', () => {
    const onTerminal = vi.fn();
    const subscribeMidi = vi.fn(() => vi.fn());
    const attempt = createAssessmentAttempt({ expectation: compileAssessmentExpectation({ events: [{ notes: [] }] }) });
    const runtime = createAssessmentRuntime({ attempt, now: () => 10, tickMs: 0, subscribeMidi, onTerminal });
    runtime.start();
    expect(runtime.getSnapshot()).toMatchObject({ status: 'completed', result: { score: 1 } });
    expect(onTerminal).toHaveBeenCalledWith(expect.objectContaining({ score: 1 }), expect.objectContaining({ status: 'completed' }));
    expect(subscribeMidi).not.toHaveBeenCalled();
  });

  it('ignores stale observations after disposal', () => {
    const onEvent = vi.fn();
    const runtime = createAssessmentRuntime({ attempt: makeAttempt(), now: () => 10, tickMs: 0, onEvent });
    runtime.start();
    runtime.dispose();
    const result = runtime.observe({ midi: 60, time: 20 });
    expect(result.event).toEqual({ type: 'ignored', reason: 'disposed' });
    expect(runtime.getSnapshot()).toMatchObject({ status: 'running', hits: {} });
    expect(onEvent).not.toHaveBeenCalled();
  });
});
