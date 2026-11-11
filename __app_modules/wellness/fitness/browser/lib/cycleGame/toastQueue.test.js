import { describe, it, expect } from 'vitest';
import { pushToast, nextToast, toastDurationMs, TOAST_MAX_AGE_MS, TOAST_KEEP_VARIANTS } from './toastQueue.js';

describe('toastQueue', () => {
  it('drops a queued toast that has gone stale', () => {
    const q = pushToast([], { id: 1, variant: 'lead-change' }, 1000);
    expect(nextToast(q, 1000 + TOAST_MAX_AGE_MS + 1)).toEqual({ toast: null, queue: [] });
  });
  it('keeps milestone toasts however long they waited', () => {
    const q = pushToast([], { id: 1, variant: 'finished' }, 1000);
    expect(nextToast(q, 60000).toast.id).toBe(1);
  });
  it('a newer toast of the same variant replaces the queued one', () => {
    let q = pushToast([], { id: 1, variant: 'lead-change' }, 1000);
    q = pushToast(q, { id: 2, variant: 'lead-change' }, 1500);
    expect(q.map((e) => e.toast.id)).toEqual([2]);
  });
  it('serves fresh toasts in order', () => {
    let q = pushToast([], { id: 1, variant: 'parked' }, 1000);
    q = pushToast(q, { id: 2, variant: 'boost' }, 1100);
    const first = nextToast(q, 1200);
    expect(first.toast.id).toBe(1);
    expect(nextToast(first.queue, 1300).toast.id).toBe(2);
  });
  it('does not mutate its input array', () => {
    const q = [{ toast: { id: 1, variant: 'lead-change' }, atMs: 1 }];
    const copy = JSON.parse(JSON.stringify(q));
    const out = pushToast(q, { id: 2, variant: 'lead-change' }, 2);
    expect(q).toEqual(copy);
    expect(out).not.toBe(q);
    const frozen = Object.freeze([...q]);
    expect(() => pushToast(frozen, { id: 3, variant: 'boost' }, 3)).not.toThrow();
  });
  it('two finishers both show: a milestone is never replaced by a newer one of the same variant', () => {
    let q = pushToast([], { id: 1, variant: 'finished' }, 1000);
    q = pushToast(q, { id: 2, variant: 'finished' }, 1100);
    const first = nextToast(q, 1200);
    expect(first.toast.id).toBe(1);
    expect(nextToast(first.queue, 1300).toast.id).toBe(2);
  });
  it('nextToast on an empty queue (or undefined) yields nothing', () => {
    expect(nextToast([], 1000)).toEqual({ toast: null, queue: [] });
    expect(nextToast(undefined, 1000)).toEqual({ toast: null, queue: [] });
  });
  it('mixed stale and fresh: returns the first fresh one and drops the stale ones', () => {
    let q = pushToast([], { id: 1, variant: 'lead-change' }, 1000);
    q = pushToast(q, { id: 2, variant: 'boost' }, 1100);
    q = pushToast(q, { id: 3, variant: 'parked' }, 20000);
    q = pushToast(q, { id: 4, variant: 'halfway' }, 20100);
    const out = nextToast(q, 20200);
    expect(out.toast.id).toBe(3);
    expect(out.queue.map((e) => e.toast.id)).toEqual([4]);
  });
  it('exports a frozen milestone list without parked or boost', () => {
    expect(Object.isFrozen(TOAST_KEEP_VARIANTS)).toBe(true);
    expect(Array.isArray(TOAST_KEEP_VARIANTS)).toBe(true);
    expect(TOAST_KEEP_VARIANTS).toContain('finished');
    expect(TOAST_KEEP_VARIANTS).not.toContain('parked');
    expect(TOAST_KEEP_VARIANTS).not.toContain('boost');
  });
  it('toastDurationMs: 4000 for milestones, 3000 otherwise', () => {
    TOAST_KEEP_VARIANTS.forEach((v) => expect(toastDurationMs(v)).toBe(4000));
    expect(toastDurationMs('lead-change')).toBe(3000);
    expect(toastDurationMs('boost')).toBe(3000);
    expect(toastDurationMs(undefined)).toBe(3000);
  });
  it('ignores a missing toast or a non-finite clock without throwing', () => {
    expect(pushToast([], null, 1)).toEqual([]);
    expect(() => pushToast(undefined, { id: 1, variant: 'boost' }, NaN)).not.toThrow();
    const q = pushToast([], { id: 1, variant: 'boost' }, NaN);
    expect(nextToast(q, NaN).toast.id).toBe(1);
  });
});
