import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { holdSettled, overlayHolds, queueWrite, useEffectHolds, writesWaiting } from './effectHolds.js';

const row = (id, over = {}) => ({ id, effect: 'mute', acts: true, ...over });
const film = (rows, fresh = true) => ({ audit: { ok: true, fresh }, rows });

describe('queueWrite', () => {
  it('runs one film\'s writes in order, and a failed one does not stop the next', async () => {
    const order = [];
    let open;
    const first = queueWrite('q1', () => new Promise((r) => { open = r; }).then(() => order.push('timing')));
    const second = queueWrite('q1', async () => { order.push('effect'); throw new Error('nope'); });
    const third = queueWrite('q1', async () => order.push('card'));
    expect(writesWaiting('q1')).toBe(true);
    await Promise.resolve();
    expect(order).toEqual([]);
    open();
    await first; await expect(second).rejects.toThrow('nope'); await third;
    expect(order).toEqual(['timing', 'effect', 'card']);
    await Promise.resolve(); await Promise.resolve();
    expect(writesWaiting('q1')).toBe(false);
  });
});

describe('overlayHolds / holdSettled', () => {
  it('shows a held effect in place of the audit\'s; Off makes the part play', () => {
    const data = film([row('a'), row('b')]);
    const out = overlayHolds(data, { a: { to: 'skip' }, b: { to: 'off' } });
    expect(out.rows[0]).toEqual(expect.objectContaining({ effect: 'skip', acts: true, effectHeld: true }));
    expect(out.rows[1]).toEqual(expect.objectContaining({ acts: false, effectHeld: true }));
    expect(overlayHolds(data, {})).toBe(data);
  });
  it('a full blur settles a Blur hold; a blackout does not', () => {
    expect(holdSettled(row('a', { effect: 'full-blur' }), 'blur')).toBe(true);
    expect(holdSettled(row('a', { effect: 'blackout' }), 'blur')).toBe(false);
    expect(holdSettled(row('a', { acts: false }), 'off')).toBe(true);
  });
});

describe('useEffectHolds', () => {
  const logger = { info: vi.fn(), warn: vi.fn() };
  it('holds the chosen effect through the stale audit, then lets go when the fresh one agrees', () => {
    let served = film([row('a')]); let gen = 0;
    const { result, rerender } = renderHook(() => useEffectHolds(served, { rk: '7', logger, gen: () => gen }));
    let s;
    act(() => { s = result.current.hold('a', 'skip', 'Skip'); });
    expect(result.current.data.rows[0].effect).toBe('skip');
    act(() => { result.current.saved('a', s); });
    // A poll sent before the save lands after it, fresh and old: it is not believed.
    served = film([row('a')]); rerender();
    expect(result.current.data.rows[0].effect).toBe('skip');
    served = film([row('a')], false); rerender();
    expect(result.current.data.rows[0].effect).toBe('skip');
    served = film([row('a', { effect: 'skip' })]); rerender();
    expect(result.current.data.rows[0]).toEqual(expect.objectContaining({ effect: 'skip' }));
    expect(result.current.data.rows[0].effectHeld).toBeUndefined();
    expect(logger.info).toHaveBeenCalledWith('content_filter.review.effect_settled', expect.objectContaining({ rk: '7', rowId: 'a', to: 'skip' }));
    expect(result.current.note).toBeNull();
  });
  it('says so when the player plays the choice as something else (Blur with nothing to blur)', () => {
    let served = film([row('p', { effect: 'blackout', label: 'poster' })]); let gen = 0;
    const { result, rerender } = renderHook(() => useEffectHolds(served, { rk: '7', logger, gen: () => gen }));
    let s;
    act(() => { s = result.current.hold('p', 'blur', 'Blur'); result.current.saved('p', s); });
    gen = 1;
    served = film([row('p', { effect: 'blackout', label: 'poster' })], false); rerender();
    served = film([row('p', { effect: 'blackout', label: 'poster' })]); rerender();
    expect(result.current.data.rows[0].effect).toBe('blackout');
    expect(result.current.note.text).toBe('Blur plays as hidden on "poster".');
    expect(logger.info).toHaveBeenCalledWith('content_filter.review.effect_resolved_differently', expect.objectContaining({ asked: 'blur', plays: 'blackout' }));
  });
  it('a later click replaces an earlier one; a failed save lets the row show the server again', () => {
    const served = film([row('a')]);
    const { result } = renderHook(() => useEffectHolds(served, { rk: '7', logger }));
    let first; let second;
    act(() => { first = result.current.hold('a', 'skip', 'Skip'); second = result.current.hold('a', 'bleep', 'Bleep'); });
    expect(result.current.isCurrent('a', first)).toBe(false);
    expect(result.current.isCurrent('a', second)).toBe(true);
    expect(result.current.data.rows[0].effect).toBe('bleep');
    act(() => { result.current.release('a', second); });
    expect(result.current.data.rows[0].effect).toBe('mute');
  });
});

describe('useEffectHolds: settling and timeouts', () => {
  const logger = { info: vi.fn(), warn: vi.fn() };
  afterEach(() => { vi.useRealTimers(); });

  it('a fresh disagreeing answer to a reload made after the save is believed', () => {
    // The digest is content-based: a PUT that changes nothing leaves the audit fresh, so no stale answer ever comes.
    let served = film([row('a', { effect: 'blackout', label: 'poster' })]); let gen = 3;
    const { result, rerender } = renderHook(() => useEffectHolds(served, { rk: '7', logger, gen: () => gen }));
    let s;
    act(() => { s = result.current.hold('a', 'blur', 'Blur'); result.current.saved('a', s); });
    // A fresh answer to a reload issued before the save is not believed.
    served = film([row('a', { effect: 'blackout', label: 'poster' })]); rerender();
    expect(result.current.data.rows[0].effectHeld).toBe(true);
    gen = 4; // the page issued a reload after the save
    served = film([row('a', { effect: 'blackout', label: 'poster' })]); rerender();
    expect(result.current.data.rows[0].effectHeld).toBeUndefined();
    expect(result.current.note.text).toBe('Blur plays as hidden on "poster".');
  });

  it('a hold that is never saved expires at 20 s with a note', () => {
    vi.useFakeTimers();
    const served = film([row('a', { label: 'alpha' })]);
    const { result } = renderHook(() => useEffectHolds(served, { rk: '7', logger, gen: () => 0 }));
    act(() => { result.current.hold('a', 'skip', 'Skip'); });
    act(() => { vi.advanceTimersByTime(19000); });
    expect(result.current.data.rows[0].effectHeld).toBe(true);
    act(() => { vi.advanceTimersByTime(1500); });
    expect(result.current.data.rows[0].effectHeld).toBeUndefined();
    expect(result.current.note.text).toBe('Skip is taking long to confirm; showing what the server has.');
  });

  it('later holds do not push an earlier hold\'s deadline out', () => {
    vi.useFakeTimers();
    const served = film([row('a'), row('b')]);
    const { result } = renderHook(() => useEffectHolds(served, { rk: '7', logger, gen: () => 0 }));
    act(() => { result.current.hold('a', 'skip', 'Skip'); });
    act(() => { vi.advanceTimersByTime(15000); });
    act(() => { result.current.hold('b', 'skip', 'Skip'); });
    act(() => { vi.advanceTimersByTime(5500); });
    expect(result.current.data.rows[0].effectHeld).toBeUndefined();
    expect(result.current.data.rows[1].effectHeld).toBe(true);
  });

  it('a hung write rejects at 15 s and the next queued write runs', async () => {
    vi.useFakeTimers();
    const first = queueWrite('hung', () => new Promise(() => {}));
    const caught = expect(first).rejects.toThrow(/did not answer/);
    const second = queueWrite('hung', async () => 'ran');
    await vi.advanceTimersByTimeAsync(15000);
    await caught;
    await expect(second).resolves.toBe('ran');
  });

  it('notes queue: two resolved holds leave two notes, and ackNotes clears the shown ones', () => {
    let served = film([row('a', { effect: 'blackout', label: 'one' }), row('b', { effect: 'blackout', label: 'two' })]); let gen = 0;
    const { result, rerender } = renderHook(() => useEffectHolds(served, { rk: '7', logger, gen: () => gen }));
    act(() => { const a = result.current.hold('a', 'blur', 'Blur'); const b = result.current.hold('b', 'blur', 'Blur'); result.current.saved('a', a); result.current.saved('b', b); });
    gen = 1; served = film([...served.rows]); rerender();
    expect(result.current.notes.map((n) => n.rowId)).toEqual(['a', 'b']);
    act(() => { result.current.ackNotes(result.current.notes[1].at + 1); });
    expect(result.current.notes).toEqual([]);
  });

  it('Skip that resolves to off reads "plays unfiltered"', () => {
    let served = film([row('a', { label: 'alpha' })]); let gen = 0;
    const { result, rerender } = renderHook(() => useEffectHolds(served, { rk: '7', logger, gen: () => gen }));
    act(() => { const a = result.current.hold('a', 'skip', 'Skip'); result.current.saved('a', a); });
    gen = 1; served = film([row('a', { acts: false, label: 'alpha' })]); rerender();
    expect(result.current.note.text).toBe('Skip plays unfiltered on "alpha".');
  });
});
