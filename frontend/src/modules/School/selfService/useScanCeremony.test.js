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

  // THE CEREMONY IS A FALLBACK, NOT A RECEIPT.
  //
  // When the result receipt prints, the paper in the child's hand IS the
  // feedback — repeating the score on a wall panel in a shared room is both
  // redundant and a grade read out loud to whoever is in the room. So a
  // graded scan whose receipt printed shows NOTHING; the ceremony survives
  // only for the case where the sheet was read but the outcome never reached
  // paper, and then it says so rather than reading out a score.
  it('shows NO ceremony for a graded scan whose receipt printed — the paper is the feedback', () => {
    const { result } = mount();
    act(() => {
      deliver({
        topic: 'omr', event: 'scan-graded', testId: 't1', learnerId: 'kid1',
        correctCount: 8, totalCount: 10, percent: 80, result: 'passed', sessionId: 's1',
        printed: true, printReason: null, timestamp: 1000,
      });
    });
    expect(result.current.current).toBeNull();
  });

  it('shows a ceremony for a graded scan whose receipt did NOT print — and never reads out the score', () => {
    const { result } = mount();
    act(() => {
      deliver({
        topic: 'omr', event: 'scan-graded', testId: 't1', learnerId: 'kid1',
        correctCount: 8, totalCount: 10, percent: 80, result: 'passed', sessionId: 's1',
        printed: false, printReason: 'printer_error', timestamp: 1000,
      });
    });
    expect(result.current.current).toEqual({
      tone: 'warn',
      title: 'I got your sheet',
      detail: "It's marked, but nothing printed. Tell a grown-up.",
      at: 1000,
    });
    // The whole point: the grade is NOT announced on the wall.
    expect(result.current.current.detail).not.toMatch(/8|10|80/);
  });

  it('tells the learner exactly what to do when answer-sheet identity is held', () => {
    const { result } = mount();
    act(() => {
      deliver({ topic: 'omr', event: 'scan-answer-sheet-held', reason: 'multiple-delivered-live-answer-sheets' });
    });
    expect(result.current.current).toMatchObject({
      tone: 'warn', title: 'Ask a grown-up',
      detail: 'Two answer sheets are active. Ask a grown-up to check this scan.',
    });
  });

  it('shows the ceremony when the wire says nothing about printing at all', () => {
    // An older backend (or any payload missing `printed`) must fail toward
    // SPEAKING: silence is only ever correct when paper is known to have
    // come out.
    const { result } = mount();
    act(() => {
      deliver({ topic: 'omr', event: 'scan-graded', testId: 't1', correctCount: null, totalCount: null });
    });
    expect(result.current.current).toMatchObject({ tone: 'warn', title: 'I got your sheet' });
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

  it('names the exact empty row when a sheet is scored but unfinished', () => {
    // 2026-08-26: two of three answered, row 45 blank, and all three feeds of
    // the card returned nothing at all.
    const { result } = mount();
    act(() => {
      deliver({ topic: 'omr', event: 'scan-rows-incomplete', testId: '4071314', blankRows: [45] });
    });
    expect(result.current.current).toMatchObject({
      tone: 'error',
      title: 'Not finished yet',
      detail: 'Row 45 is still empty. Then scan again.',
    });
  });

  it('names a double mark alongside the empty rows, and pluralises both', () => {
    const { result } = mount();
    act(() => {
      deliver({
        topic: 'omr', event: 'scan-rows-incomplete', testId: '4071314',
        blankRows: [45, 46], ambiguousRows: [44],
      });
    });
    expect(result.current.current.detail).toBe(
      'Rows 45 and 46 are still empty. Row 44 has more than one answer marked — erase the extra. Then scan again.',
    );
  });

  it('still speaks when the payload carries no rows at all', () => {
    // Silence is the exact failure this event exists to end, so a payload with
    // nothing to name must not drop the ceremony.
    const { result } = mount();
    act(() => {
      deliver({ topic: 'omr', event: 'scan-rows-incomplete', testId: '4071314' });
    });
    expect(result.current.current).toMatchObject({ tone: 'error', title: 'Not finished yet' });
    expect(result.current.current.detail).toBe('Then scan again.');
  });

  it('maps scan-not-recorded to an error ceremony so a re-fed sheet is never met with silence', () => {
    const { result } = mount();
    act(() => {
      deliver({ topic: 'omr', event: 'scan-not-recorded', testId: '0123456', learnerId: 'learner3' });
    });
    expect(result.current.current).toMatchObject({
      tone: 'error',
      title: 'Already done',
      detail: 'I read that sheet, but there was nothing new to mark.',
    });
    // `error` drives the double-buzz (scanCeremonySound.js). It is not a score,
    // and the operator's rule is that a scan always makes a noise.
    expect(result.current.current.tone).toBe('error');
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

  // 2026-08-26. A child fed his cumulative card four times over two and a half
  // minutes. Today's worksheet was rows 34-39 and he had not bubbled them, so
  // the only marks on the card were the older, already-graded ones. The backend
  // returned early and broadcast nothing at all, so this panel showed nothing
  // and the speaker stayed quiet. He gave up and tapped his NFC card instead.
  it('maps scan-rows-unmarked to an error ceremony naming the rows still to fill in', () => {
    const { result } = mount();
    act(() => {
      deliver({
        topic: 'omr',
        event: 'scan-rows-unmarked',
        testId: '0123456',
        learnerId: 'learner3',
        rowRange: { start: 34, end: 39 },
      });
    });
    expect(result.current.current).toMatchObject({
      tone: 'error',
      title: 'Nothing filled in yet',
      detail: 'Your new questions are rows 34–39. Fill them in, then scan again.',
    });
  });

  it('rings the error tone for unmarked rows — the buzz is the whole point', () => {
    // `error`, deliberately, over `warn`: this is the low double-buzz that says
    // "that did not work". The child glancing away from the screen has to be
    // able to tell from the SOUND alone that feeding the card achieved nothing.
    const { result } = mount();
    act(() => {
      deliver({ topic: 'omr', event: 'scan-rows-unmarked', testId: '0123456', rowRange: { start: 7, end: 12 } });
    });
    expect(result.current.current.tone).toBe('error');
  });

  // A cumulative card can carry more than one unmarked live worksheet
  // (final review MINOR 4) — naming only the first left the child unaware
  // of the second.
  it('names every unmarked live worksheet, not just the first, when rowRanges carries more than one', () => {
    const { result } = mount();
    act(() => {
      deliver({
        topic: 'omr',
        event: 'scan-rows-unmarked',
        testId: '0123456',
        learnerId: 'learner3',
        rowRange: { start: 34, end: 39 },
        rowRanges: [{ start: 34, end: 39 }, { start: 40, end: 45 }],
      });
    });
    expect(result.current.current).toMatchObject({
      tone: 'error',
      title: 'Nothing filled in yet',
      detail: 'Your new questions are rows 34–39 and rows 40–45. Fill them in, then scan again.',
    });
  });

  it('still speaks when the row range is missing, rather than falling silent again', () => {
    // Never let a malformed payload reproduce the exact bug this event was
    // added for. Losing the row numbers costs precision; losing the ceremony
    // costs the child any feedback at all.
    const { result } = mount();
    act(() => {
      deliver({ topic: 'omr', event: 'scan-rows-unmarked', testId: '0123456' });
    });
    expect(result.current.current).toMatchObject({
      tone: 'error',
      title: 'Nothing filled in yet',
    });
    expect(result.current.current.detail).toContain('scan again');
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
    expect(scanLog).toHaveBeenCalledWith('scan-graded', { tone: 'warn', title: 'I got your sheet', code: null });
  });

  it('a suppressed graded scan still leaves a trace in the log — a silent screen is not a silent system', () => {
    mount();
    act(() => {
      deliver({ topic: 'omr', event: 'scan-graded', correctCount: 5, totalCount: 5, printed: true });
    });
    expect(scanLog).toHaveBeenCalledWith('scan-graded', { suppressed: 'receipt-printed' });
  });

  // REGRESSION GUARD: over-suppression is the failure mode this fix can
  // create. Every NON-graded outcome is a case where the screen is the only
  // feedback a child gets, so `printed` — whatever it says, including
  // `true` — must never silence one of them.
  it.each([
    ['scan-review', { pendingReview: 1 }, 'Needs a grown-up'],
    ['scan-unresolved', { code: 'CARD_ID_UNREADABLE' }, "Couldn't read that sheet"],
    ['scan-refused', { code: 'unknown_card' }, "That sheet doesn't match"],
    ['scan-answer-sheet-held', {}, 'Ask a grown-up'],
    ['reader-error', {}, 'Scanner hiccup'],
  ])('still shows %s even when the payload claims printed:true', (event, extra, title) => {
    const { result } = mount();
    act(() => {
      deliver({ topic: 'omr', event, printed: true, ...extra });
    });
    expect(result.current.current).not.toBeNull();
    expect(result.current.current.title).toBe(title);
  });

  it('a new scan replaces the current ceremony', () => {
    const { result } = mount();
    act(() => {
      deliver({ topic: 'omr', event: 'scan-graded', correctCount: 5, totalCount: 5 });
    });
    expect(result.current.current.title).toBe('I got your sheet');
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
  // A story finished at the living-room TV. Same requirement as the piano
  // ceremony it follows: a child working away from this panel must still see
  // that it counted on the board that tracks their day.
  it('shows a story read, naming the book', () => {
    const { result } = mount();
    act(() => {
      deliver({
        topic: 'school', event: 'story-read', learnerId: 'learner-c',
        title: 'Frog and Toad', contentId: 'plex:620681', studyDay: '2026-08-26', pickId: 'pick_1',
      });
    });
    expect(result.current.current).toMatchObject({ tone: 'success', title: 'Story read!' });
    expect(result.current.current.detail).toContain('Frog and Toad');
  });

  it('shows a story read with no title at all rather than nothing', () => {
    const { result } = mount();
    act(() => {
      deliver({ topic: 'school', event: 'story-read', learnerId: 'learner-c', title: null });
    });
    expect(result.current.current).toMatchObject({ tone: 'success', title: 'Story read!' });
  });

  // The read is the evidence; the banner is the courtesy. `printed` belongs to
  // graded sheets and must not silence an event that never touches a printer.
  it('is never suppressed by a printed flag riding along', () => {
    const { result } = mount();
    act(() => {
      deliver({ topic: 'school', event: 'story-read', title: 'Corduroy', printed: true });
    });
    expect(result.current.current).not.toBeNull();
  });
});
