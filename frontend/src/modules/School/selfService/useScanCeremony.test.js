import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Shared spies, hoisted so the vi.mock factories can close over them (pattern:
// useSchoolLaunch.test.jsx) — capture the subscriber callback so tests can
// push WS messages at it directly.
const h = vi.hoisted(() => ({ handlers: [] }));

vi.mock('../../../hooks/useWebSocket.js', () => ({
  useWebSocketSubscription: (_topic, cb) => { h.handlers[0] = cb; },
}));

const debugFn = vi.fn();
const child = vi.fn(() => ({ info: vi.fn(), debug: debugFn, warn: vi.fn(), error: vi.fn() }));
const getLoggerMock = vi.fn(() => ({ child }));
vi.mock('../../../lib/logging/Logger.js', () => ({
  default: (...args) => getLoggerMock(...args),
}));

const scanLog = vi.fn();
vi.mock('../schoolLog.js', () => ({
  schoolLog: { scan: (...args) => scanLog(...args) },
}));

import { useScanCeremony } from './useScanCeremony.js';

const deliver = (msg) => h.handlers[0](msg);

describe('useScanCeremony', () => {
  beforeEach(() => {
    h.handlers.length = 0;
    debugFn.mockClear();
    child.mockClear();
    getLoggerMock.mockClear();
    scanLog.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const mount = (opts) => renderHook(() => useScanCeremony(opts));

  it('starts with no ceremony showing', () => {
    const { result } = mount();
    expect(result.current.current).toBeNull();
  });

  it('maps scan-graded to a success ceremony with the score', () => {
    const { result } = mount();
    act(() => {
      deliver({
        topic: 'omr', event: 'scan-graded', testId: 't1', learnerId: 'kid1',
        correctCount: 8, totalCount: 10, percent: 80, result: 'graded', sessionId: 's1',
        timestamp: 1000,
      });
    });
    expect(result.current.current).toEqual({
      tone: 'success',
      title: 'Scored!',
      detail: '8 of 10 right — your sheet is printing.',
      at: 1000,
    });
  });

  it('falls back to a scoreless success message when points are missing', () => {
    const { result } = mount();
    act(() => {
      deliver({ topic: 'omr', event: 'scan-graded', testId: 't1', correctCount: null, totalCount: null });
    });
    expect(result.current.current.tone).toBe('success');
    expect(result.current.current.detail).toBe('Your sheet is printing.');
  });

  it('maps scan-review to a warn ceremony naming the pending count', () => {
    const { result } = mount();
    act(() => {
      deliver({
        topic: 'omr', event: 'scan-review', testId: 't1', learnerId: 'kid1',
        sessionId: 's1', pendingReview: 1, reasons: ['ambiguous'], items: ['q3'],
      });
    });
    expect(result.current.current.tone).toBe('warn');
    expect(result.current.current.title).toBe('Needs a grown-up');
    expect(result.current.current.detail).toBe('One question had two answers filled in. Ask a grown-up to check it.');
  });

  it('pluralizes scan-review copy for more than one pending item', () => {
    const { result } = mount();
    act(() => {
      deliver({ topic: 'omr', event: 'scan-review', pendingReview: 3, reasons: ['ambiguous'], items: ['q1', 'q2', 'q3'] });
    });
    expect(result.current.current.detail).toBe('3 questions had two answers filled in. Ask a grown-up to check it.');
  });

  it('maps scan-unresolved to an error ceremony carrying the code', () => {
    const { result } = mount();
    act(() => {
      deliver({ topic: 'omr', event: 'scan-unresolved', code: 'CARD_ID_UNREADABLE', testId: '?', testIdCandidates: [] });
    });
    expect(result.current.current).toMatchObject({
      tone: 'error',
      title: "Couldn't read that sheet",
      detail: "The student number didn't come through. Try scanning again, slowly.",
      code: 'CARD_ID_UNREADABLE',
    });
  });

  it('maps scan-refused to an error ceremony carrying the code', () => {
    const { result } = mount();
    act(() => {
      deliver({ topic: 'omr', event: 'scan-refused', code: 'ALLOCATION_ROW_MAPPING_DRIFT', recordId: 'rec1' });
    });
    expect(result.current.current).toMatchObject({
      tone: 'error',
      title: "That sheet doesn't match",
      detail: "This paper doesn't line up with what's on file. Ask a grown-up.",
      code: 'ALLOCATION_ROW_MAPPING_DRIFT',
    });
  });

  it('maps scan-stale-sheet to a warn ceremony that tells the child how to fix it themselves', () => {
    const { result } = mount();
    act(() => {
      deliver({ topic: 'omr', event: 'scan-stale-sheet', code: 'dead_card', testId: '0123456' });
    });
    expect(result.current.current).toMatchObject({
      tone: 'warn',
      title: 'That sheet is out of date',
      detail: 'Scan your card to print a fresh one, then try again.',
      code: 'dead_card',
    });
    // `warn`, not `error`: nothing malfunctioned, and the tone family drives
    // the sound (a held mid tone — "pause", not an alarm).
    expect(result.current.current.tone).not.toBe('error');
  });

  it('maps reader-error to an error ceremony', () => {
    const { result } = mount();
    act(() => {
      deliver({ topic: 'omr', id: 'r1', event: 'reader-error', echo: '49303F', ts: 999, source: 'omr-relay' });
    });
    expect(result.current.current).toMatchObject({
      tone: 'error',
      title: 'Scanner hiccup',
      detail: "The scanner didn't catch that. Feed the sheet again.",
    });
  });

  it('ignores an unrelated event name on the same topic', () => {
    const { result } = mount();
    act(() => {
      deliver({ topic: 'omr', event: 'sheet', marks: [] });
    });
    expect(result.current.current).toBeNull();
    expect(debugFn).toHaveBeenCalledWith('ceremony-ignored', { event: 'sheet' });
  });

  it('logs every ceremony through the schoolLog scan facade', () => {
    mount();
    act(() => {
      deliver({ topic: 'omr', event: 'scan-graded', correctCount: 5, totalCount: 5 });
    });
    expect(scanLog).toHaveBeenCalledWith('scan-graded', { tone: 'success', title: 'Scored!', code: null });
  });

  it('a new scan replaces the current ceremony', () => {
    const { result } = mount();
    act(() => {
      deliver({ topic: 'omr', event: 'scan-graded', correctCount: 5, totalCount: 5 });
    });
    expect(result.current.current.title).toBe('Scored!');
    act(() => {
      deliver({ topic: 'omr', event: 'scan-unresolved', code: 'CARD_ID_UNREADABLE' });
    });
    expect(result.current.current.title).toBe("Couldn't read that sheet");
  });

  it('auto-clears after ~12s', () => {
    const { result } = mount();
    act(() => {
      deliver({ topic: 'omr', event: 'scan-graded', correctCount: 5, totalCount: 5 });
    });
    expect(result.current.current).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(12000);
    });
    expect(result.current.current).toBeNull();
  });

  it('a replacement scan restarts the auto-clear clock', () => {
    const { result } = mount();
    act(() => {
      deliver({ topic: 'omr', event: 'scan-graded', correctCount: 5, totalCount: 5 });
    });
    act(() => {
      vi.advanceTimersByTime(9000);
    });
    act(() => {
      deliver({ topic: 'omr', event: 'scan-unresolved', code: 'CARD_ID_UNREADABLE' });
    });
    act(() => {
      vi.advanceTimersByTime(9000); // 18s from first scan, but only 9s from the second
    });
    expect(result.current.current).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(3000); // 12s from the second scan
    });
    expect(result.current.current).toBeNull();
  });

  it('clear() dismisses the ceremony immediately', () => {
    const { result } = mount();
    act(() => {
      deliver({ topic: 'omr', event: 'scan-graded', correctCount: 5, totalCount: 5 });
    });
    act(() => {
      result.current.clear();
    });
    expect(result.current.current).toBeNull();
  });
});
