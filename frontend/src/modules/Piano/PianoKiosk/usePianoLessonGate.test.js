import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  response: { gated: false, reason: 'done' },
  handlers: [],
}));

vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(async () => (h.response instanceof Promise ? h.response : h.response)),
}));
vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() }) }),
}));
// Capture the subscriber so tests can push School events at it directly.
vi.mock('../../../hooks/useWebSocket.js', () => ({
  useWebSocketSubscription: (_topic, cb) => { h.handlers[0] = cb; },
}));

import { DaylightAPI } from '../../../lib/api.mjs';
import usePianoLessonGate, { LOADING_CEILING_MS, REFRESH_MS } from './usePianoLessonGate.js';

const OWED = {
  gated: true,
  reason: 'owed',
  course: { id: 'plex:1', title: 'Hoffman Academy' },
  unit: { id: '3', title: 'Unit 3' },
  lesson: { id: 'plex:2', title: 'Lesson 5' },
};

const CHALLENGE = {
  id: 'unit-3-c-major',
  ask: { id: 'named-c-major' },
  materialSpec: { kind: 'chord', root: 'C', quality: 'major' },
  framing: 'Play a C major chord.',
};

const deliver = (msg) => act(() => { h.handlers[0]?.(msg); });

beforeEach(() => {
  h.response = { gated: false, reason: 'done' };
  h.handlers = [];
  // Reset, not just clear: a test that installs a persistent rejection must
  // not leak it into the next one.
  DaylightAPI.mockReset();
  DaylightAPI.mockImplementation(async () => h.response);
});

const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { status });

afterEach(() => vi.useRealTimers());

describe('usePianoLessonGate', () => {
  it('gates on an owed lesson and surfaces course/unit/lesson', async () => {
    h.response = OWED;
    const { result } = renderHook(() => usePianoLessonGate('kid-one'));
    await waitFor(() => expect(result.current.gated).toBe(true));
    expect(result.current.lesson).toEqual({ id: 'plex:2', title: 'Lesson 5' });
    expect(result.current.course.title).toBe('Hoffman Academy');
    expect(DaylightAPI).toHaveBeenCalledWith(
      'api/v1/school/lifecycle/learners/kid-one/piano-lesson-gate',
    );
  });

  it('surfaces a configured PianoChallenge only while the lesson is gated', async () => {
    h.response = { ...OWED, challenge: CHALLENGE };
    const { result } = renderHook(() => usePianoLessonGate('kid-one'));
    await waitFor(() => expect(result.current.gated).toBe(true));
    expect(result.current.challenge).toEqual(CHALLENGE);
  });

  it('does not gate a discharged day', async () => {
    const { result } = renderHook(() => usePianoLessonGate('kid-one'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.gated).toBe(false);
  });

  it('never fetches for Guest, and never gates them', async () => {
    const { result } = renderHook(() => usePianoLessonGate('guest'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.gated).toBe(false);
    expect(DaylightAPI).not.toHaveBeenCalled();
  });

  // The gate hides the WHOLE menu, so a broken read must never lock a child
  // out. This is the deliberate opposite of useSchoolGameAccess's fail-closed
  // reward gate. But "never locks a child out" is not "opens instantly": a
  // read that fails in 200ms used to open every door before the child's finger
  // landed — the same escape as the hang, with no pending window at all.
  it('fails open at the ceiling when every read fails', async () => {
    vi.useFakeTimers();
    DaylightAPI.mockImplementation(async () => { throw httpError(500); });
    const { result } = renderHook(() => usePianoLessonGate('kid-one'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    // Not open yet — the failure was instant, the menu is not.
    expect(result.current).toMatchObject({ status: 'loading', pending: true, gated: false });

    await act(async () => { await vi.advanceTimersByTimeAsync(LOADING_CEILING_MS + 10); });
    expect(result.current).toMatchObject({ status: 'timeout', pending: false, gated: false });
  });

  it('holds the learner pending through a transient failure, and the poll recovers it', async () => {
    vi.useFakeTimers();
    h.response = OWED;
    DaylightAPI.mockImplementationOnce(async () => { throw new Error('offline'); });
    const { result } = renderHook(() => usePianoLessonGate('kid-one'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current).toMatchObject({ status: 'loading', pending: true, gated: false });

    await act(async () => { await vi.advanceTimersByTimeAsync(REFRESH_MS + 10); });
    expect(result.current).toMatchObject({ status: 'ready', pending: false, gated: true });
  });

  // A School-less install answers 404 on every read. Holding those learners
  // pending for the full ceiling on every single pick would be the fault the
  // fail-open rule exists to prevent, so a 4xx is a definite answer.
  it('opens at once on a 404 rather than waiting out the ceiling', async () => {
    vi.useFakeTimers();
    DaylightAPI.mockImplementation(async () => { throw httpError(404); });
    const { result } = renderHook(() => usePianoLessonGate('kid-one'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current).toMatchObject({ status: 'error', pending: false, gated: false });
    expect(DaylightAPI).toHaveBeenCalledTimes(1);
  });

  // One field, computed once, so no consumer has to re-derive the guest rule.
  it('reports pending for exactly the learners whose verdict is outstanding', async () => {
    const guest = renderHook(() => usePianoLessonGate('guest'));
    await waitFor(() => expect(guest.result.current.status).toBe('ready'));
    expect(guest.result.current.pending).toBe(false);

    h.response = new Promise(() => {});
    const named = renderHook(() => usePianoLessonGate('kid-one'));
    expect(named.result.current.pending).toBe(true);

    const nobody = renderHook(() => usePianoLessonGate(null));
    expect(nobody.result.current.pending).toBe(false);
  });

  it('stops being pending the moment a verdict lands', async () => {
    h.response = OWED;
    const { result } = renderHook(() => usePianoLessonGate('kid-one'));
    expect(result.current.pending).toBe(true);
    await waitFor(() => expect(result.current.gated).toBe(true));
    expect(result.current.pending).toBe(false);
  });

  it('renders not-gated while the first read is still in flight', () => {
    h.response = new Promise(() => {});
    const { result } = renderHook(() => usePianoLessonGate('kid-one'));
    expect(result.current.gated).toBe(false);
    expect(result.current.status).toBe('loading');
  });

  it('never carries one learner\'s gate across an identity switch', async () => {
    h.response = OWED;
    const { result, rerender } = renderHook(
      ({ learnerId }) => usePianoLessonGate(learnerId),
      { initialProps: { learnerId: 'kid-one' } },
    );
    await waitFor(() => expect(result.current.gated).toBe(true));

    h.response = new Promise(() => {});
    rerender({ learnerId: 'kid-two' });
    expect(result.current).toMatchObject({ status: 'loading', gated: false });
  });

  it('polls while the kiosk remains mounted', async () => {
    vi.useFakeTimers();
    h.response = OWED;
    const { result } = renderHook(() => usePianoLessonGate('kid-one'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.gated).toBe(true);

    h.response = { gated: false, reason: 'done' };
    await act(async () => { await vi.advanceTimersByTimeAsync(REFRESH_MS); });
    expect(result.current.gated).toBe(false);
  });

  it('re-reads immediately when this learner completes a lesson', async () => {
    h.response = OWED;
    const { result } = renderHook(() => usePianoLessonGate('kid-one'));
    await waitFor(() => expect(result.current.gated).toBe(true));

    h.response = { gated: false, reason: 'done' };
    await deliver({ event: 'piano-lesson-complete', learnerId: 'kid-one' });
    await waitFor(() => expect(result.current.gated).toBe(false));
  });

  it('re-reads immediately when a parent grants a bypass', async () => {
    h.response = OWED;
    const { result } = renderHook(() => usePianoLessonGate('kid-one'));
    await waitFor(() => expect(result.current.gated).toBe(true));

    h.response = { gated: false, reason: 'bypassed' };
    await deliver({ event: 'program-day-bypass-changed', learnerId: 'kid-one', active: true });
    await waitFor(() => expect(result.current.gated).toBe(false));
  });

  it('ignores a School event about a DIFFERENT learner', async () => {
    h.response = OWED;
    const { result } = renderHook(() => usePianoLessonGate('kid-one'));
    await waitFor(() => expect(result.current.gated).toBe(true));
    const callsBefore = DaylightAPI.mock.calls.length;

    await deliver({ event: 'piano-lesson-complete', learnerId: 'kid-two' });
    expect(DaylightAPI.mock.calls.length).toBe(callsBefore);
  });

  it('ignores unrelated School events', async () => {
    h.response = OWED;
    const { result } = renderHook(() => usePianoLessonGate('kid-one'));
    await waitFor(() => expect(result.current.gated).toBe(true));
    const callsBefore = DaylightAPI.mock.calls.length;

    await deliver({ event: 'scan-graded', learnerId: 'kid-one' });
    expect(DaylightAPI.mock.calls.length).toBe(callsBefore);
  });

  // ── The pending ceiling ────────────────────────────────────────────────
  // 2026-09-01: a cold read took 11.1s and the menu was wide open for all of
  // it. An in-flight read is PENDING, not open; it fails open only once the
  // ceiling proves the read is not coming back.

  it('stays "loading" while the read is in flight and fails open as "timeout" after the ceiling', async () => {
    vi.useFakeTimers();
    let resolve;
    h.response = new Promise((r) => { resolve = r; });
    const { result } = renderHook(() => usePianoLessonGate('user_5'));
    expect(result.current.status).toBe('loading');
    expect(result.current.gated).toBe(false);

    // The 15s poll fires inside this window; it must NOT defer the ceiling.
    await act(async () => { await vi.advanceTimersByTimeAsync(LOADING_CEILING_MS + 10); });
    expect(DaylightAPI.mock.calls.length).toBeGreaterThan(1);
    expect(result.current.status).toBe('timeout');
    expect(result.current.gated).toBe(false);

    // A late answer still lands.
    await act(async () => { resolve(OWED); await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.status).toBe('ready');
    expect(result.current.gated).toBe(true);
  });

  it('is never stuck in "timeout" when a later poll answers before the ceiling', async () => {
    vi.useFakeTimers();
    h.response = new Promise(() => {}); // the first read never returns
    const { result } = renderHook(() => usePianoLessonGate('kid-one'));
    expect(result.current.status).toBe('loading');

    h.response = OWED; // the poll gets a real answer
    await act(async () => { await vi.advanceTimersByTimeAsync(REFRESH_MS + 10); });
    expect(result.current).toMatchObject({ status: 'ready', gated: true });

    // The first read's ceiling must not fire behind that answer. Every read
    // from here hangs, so nothing can quietly heal a wrong verdict.
    h.response = new Promise(() => {});
    await act(async () => { await vi.advanceTimersByTimeAsync(LOADING_CEILING_MS); });
    expect(result.current).toMatchObject({ status: 'ready', gated: true });
  });

  it('never reopens a known-gated learner because a later poll hangs', async () => {
    vi.useFakeTimers();
    h.response = OWED;
    const { result } = renderHook(() => usePianoLessonGate('kid-one'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.gated).toBe(true);

    h.response = new Promise(() => {}); // every poll from here hangs
    await act(async () => { await vi.advanceTimersByTimeAsync(REFRESH_MS + LOADING_CEILING_MS + 10); });
    expect(result.current).toMatchObject({ status: 'ready', gated: true });
  });

  // A ceiling armed for the learner who WALKED AWAY must not be spent on the
  // one who just sat down: they would be told "gave up" after a fraction of
  // the wait they were promised. Switching mid-flight is the normal case at
  // this kiosk — a child picks the wrong name and corrects it.
  it('gives the learner picked next a full ceiling of their own, not the leftovers', async () => {
    vi.useFakeTimers();
    const SWITCH_AT = LOADING_CEILING_MS / 4; // mid-flight, before the first poll
    expect(SWITCH_AT).toBeLessThan(REFRESH_MS);
    h.response = new Promise(() => {}); // nothing ever answers, for either learner
    const { result, rerender } = renderHook(
      ({ learnerId }) => usePianoLessonGate(learnerId),
      { initialProps: { learnerId: 'kid-one' } },
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(SWITCH_AT); });
    rerender({ learnerId: 'kid-two' });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    // The learner BEFORE them hits their deadline here. kid-two must not.
    await act(async () => { await vi.advanceTimersByTimeAsync(LOADING_CEILING_MS - SWITCH_AT + 10); });
    expect(result.current).toMatchObject({ learnerId: 'kid-two', status: 'loading' });

    // kid-two's own deadline, a full ceiling after they were picked.
    await act(async () => { await vi.advanceTimersByTimeAsync(SWITCH_AT); });
    expect(result.current).toMatchObject({ learnerId: 'kid-two', status: 'timeout', gated: false });
  });

  // The ceiling half of this is covered above; what only THIS test can say is
  // that kid-one's gated card is never projected onto kid-two, not even for the
  // single frame between the switch and kid-two's own read — the assertion is
  // synchronous with the rerender, before any timer or promise runs.
  it("never shows one learner's owed lesson to the learner picked next", async () => {
    vi.useFakeTimers();
    h.response = OWED;
    const { result, rerender } = renderHook(
      ({ learnerId }) => usePianoLessonGate(learnerId),
      { initialProps: { learnerId: 'kid-one' } },
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current).toMatchObject({ gated: true, lesson: OWED.lesson });

    h.response = new Promise(() => {});
    rerender({ learnerId: 'kid-two' });
    expect(result.current).toMatchObject({ status: 'loading', pending: true, gated: false });
    expect(result.current.lesson).toBeNull();
  });
});
