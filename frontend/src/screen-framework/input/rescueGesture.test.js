import { describe, it, expect } from 'vitest';
import { rescueGesture, RESCUE_PRESSES, RESCUE_WINDOW_MS } from './rescueGesture.js';

/** Feed a run of presses spaced `gapMs` apart and report every reload verdict. */
function run(count, { gapMs = 100, inputHealthy = true, repeat = false } = {}) {
  let presses = [];
  let now = 1_000_000;
  const reloads = [];
  for (let i = 0; i < count; i += 1) {
    const verdict = rescueGesture({ presses, now, inputHealthy, repeat });
    presses = verdict.presses;
    reloads.push(verdict.reload);
    now += gapMs;
  }
  return reloads;
}

describe('rescueGesture', () => {
  describe('when the input system is dead', () => {
    it('reloads on the very first press — nothing downstream will ever see the key', () => {
      const verdict = rescueGesture({ presses: [], now: 1, inputHealthy: false });
      expect(verdict.reload).toBe(true);
    });

    it('reloads even on an auto-repeat, since one press already qualifies', () => {
      expect(rescueGesture({ presses: [], now: 1, inputHealthy: false, repeat: true }).reload).toBe(true);
    });
  });

  describe('when input is healthy but something on screen is swallowing the key', () => {
    it('stays quiet for the first RESCUE_PRESSES - 1 presses', () => {
      const reloads = run(RESCUE_PRESSES - 1);
      expect(reloads.every((r) => r === false)).toBe(true);
    });

    it('reloads on exactly the RESCUE_PRESSES-th press inside the window', () => {
      const reloads = run(RESCUE_PRESSES);
      expect(reloads.slice(0, -1).every((r) => r === false)).toBe(true);
      expect(reloads.at(-1)).toBe(true);
    });

    it('does NOT reload when the same presses are spread beyond the window', () => {
      // Far enough apart that the window never holds more than one at a time —
      // an ordinary person using the "4" key for its real job, over minutes.
      const reloads = run(RESCUE_PRESSES * 3, { gapMs: RESCUE_WINDOW_MS });
      expect(reloads.every((r) => r === false)).toBe(true);
    });

    it('rearms after firing, rather than reloading on every press thereafter', () => {
      const reloads = run(RESCUE_PRESSES + 1);
      expect(reloads.at(-2)).toBe(true);
      expect(reloads.at(-1)).toBe(false);
    });

    it('ignores auto-repeat: a leaned-on key is one gesture, not many', () => {
      const reloads = run(RESCUE_PRESSES * 2, { repeat: true });
      expect(reloads.every((r) => r === false)).toBe(true);
    });

    it('never mutates the caller\'s press history in place', () => {
      const presses = [1000];
      const before = [...presses];
      rescueGesture({ presses, now: 1050, inputHealthy: true });
      expect(presses).toEqual(before);
    });
  });
});
