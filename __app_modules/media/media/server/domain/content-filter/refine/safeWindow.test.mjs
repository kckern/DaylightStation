import { describe, it, expect } from 'vitest';
import { applySafeWindows } from './safeWindow.mjs';

describe('applySafeWindows', () => {
  const cues = [
    { id: 'a', type: 'mute', in: 100, out: 100, precision: 'second-approx' },
    { id: 'b', type: 'mute', in: 200.1, out: 200.4, precision: 'ms' },
    { id: 'c', type: 'skip', in: 300, out: 306, precision: 'second-approx' },
  ];
  it('widens approximate mutes and keeps the tag span', () => {
    const [a] = applySafeWindows(cues);
    expect(a).toMatchObject({ in: 96.5, out: 103, tagIn: 100, tagOut: 100, precision: 'safe-window' });
  });
  it('leaves precise mutes and other cues alone', () => {
    const out = applySafeWindows(cues);
    expect(out[1]).toBe(cues[1]);
    expect(out[2]).toBe(cues[2]);
  });
  it('is idempotent', () => {
    const once = applySafeWindows(cues);
    expect(applySafeWindows(once)[0]).toEqual(once[0]);
  });
  it('never starts before zero', () => {
    expect(applySafeWindows([{ id: 'z', type: 'mute', in: 1, out: 1 }])[0].in).toBe(0);
  });
});
