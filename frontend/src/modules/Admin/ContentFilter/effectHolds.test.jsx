import { describe, it, expect, vi } from 'vitest';
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
    let served = film([row('a')]);
    const { result, rerender } = renderHook(() => useEffectHolds(served, { rk: '7', logger }));
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
    let served = film([row('p', { effect: 'blackout' })]);
    const { result, rerender } = renderHook(() => useEffectHolds(served, { rk: '7', logger }));
    let s;
    act(() => { s = result.current.hold('p', 'blur', 'Blur'); result.current.saved('p', s); });
    served = film([row('p', { effect: 'blackout' })], false); rerender();
    served = film([row('p', { effect: 'blackout' })]); rerender();
    expect(result.current.data.rows[0].effect).toBe('blackout');
    expect(result.current.note.text).toMatch(/^Blur plays as /);
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
