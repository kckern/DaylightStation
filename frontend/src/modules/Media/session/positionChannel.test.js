import { describe, it, expect, vi } from 'vitest';
import { createPositionChannel } from './positionChannel.js';

describe('positionChannel', () => {
  it('set updates the current value and notifies subscribers', () => {
    const ch = createPositionChannel({ nowFn: () => 1000 });
    const sub = vi.fn();
    ch.subscribe(sub);
    ch.set(42.5);
    expect(ch.get()).toEqual({ seconds: 42.5, ts: 1000 });
    expect(sub).toHaveBeenCalledWith({ seconds: 42.5, ts: 1000 });
  });

  it('ignores non-finite values', () => {
    const ch = createPositionChannel();
    const sub = vi.fn();
    ch.subscribe(sub);
    ch.set(NaN);
    ch.set(Infinity);
    ch.set('12');
    expect(sub).not.toHaveBeenCalled();
    expect(ch.get().seconds).toBe(0);
  });

  it('unsubscribe stops notifications', () => {
    const ch = createPositionChannel();
    const sub = vi.fn();
    const unsub = ch.subscribe(sub);
    unsub();
    ch.set(5);
    expect(sub).not.toHaveBeenCalled();
  });
});
