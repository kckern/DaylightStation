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
import usePianoLessonGate from './usePianoLessonGate.js';

const OWED = {
  gated: true,
  reason: 'owed',
  course: { id: 'plex:1', title: 'Hoffman Academy' },
  unit: { id: '3', title: 'Unit 3' },
  lesson: { id: 'plex:2', title: 'Lesson 5' },
};

const deliver = (msg) => act(() => { h.handlers[0]?.(msg); });

beforeEach(() => {
  h.response = { gated: false, reason: 'done' };
  h.handlers = [];
  DaylightAPI.mockClear();
});

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
  // reward gate.
  it('fails OPEN when the read fails', async () => {
    DaylightAPI.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => usePianoLessonGate('kid-one'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.gated).toBe(false);
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
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
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
});
