import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screenOff, screenOn } from './fkb.js';

describe('fkb screenOff/screenOn', () => {
  afterEach(() => {
    delete global.fully;
    vi.restoreAllMocks();
  });

  it('screenOff calls fully.turnScreenOff and returns true when available', () => {
    const turnScreenOff = vi.fn();
    global.fully = { turnScreenOff };
    expect(screenOff()).toBe(true);
    expect(turnScreenOff).toHaveBeenCalledTimes(1);
  });

  it('screenOn calls fully.turnScreenOn and returns true when available', () => {
    const turnScreenOn = vi.fn();
    global.fully = { turnScreenOn };
    expect(screenOn()).toBe(true);
    expect(turnScreenOn).toHaveBeenCalledTimes(1);
  });

  it('returns false when FKB is not present', () => {
    expect(typeof global.fully).toBe('undefined');
    expect(screenOff()).toBe(false);
    expect(screenOn()).toBe(false);
  });

  it('returns false when fully lacks the method (never throws)', () => {
    global.fully = {};
    expect(screenOff()).toBe(false);
    expect(screenOn()).toBe(false);
  });
});
