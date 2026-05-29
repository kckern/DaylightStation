import { describe, it, expect } from 'vitest';
import { CadenceFilter } from './CadenceFilter.js';

describe('CadenceFilter — fast zeroing contract', () => {
  it('holds the value before the stale threshold', () => {
    const f = new CadenceFilter();
    f.update({ rpm: 90, ts: 0 });
    const r = f.tick(500); // well within stale window
    expect(r.rpm).toBeGreaterThan(80);
    expect(r.flags.lostSignal).toBe(false);
  });

  it('reaches zero within ~2s of the last sample', () => {
    const f = new CadenceFilter();
    f.update({ rpm: 90, ts: 0 });
    const r = f.tick(2000); // at/after the tightened LOST_SIGNAL window
    expect(r.rpm).toBe(0);
    expect(r.flags.lostSignal).toBe(true);
  });

  it('is partially decayed midway through the decay window', () => {
    const f = new CadenceFilter();
    f.update({ rpm: 100, ts: 0 });
    const r = f.tick(1400); // between stale (800) and lost (2000)
    expect(r.rpm).toBeGreaterThan(0);
    expect(r.rpm).toBeLessThan(100);
    expect(r.flags.stale).toBe(true);
  });
});
