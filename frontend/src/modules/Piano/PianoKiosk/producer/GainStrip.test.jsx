/**
 * GainStrip tests — curve math (exact anchors), tap-to-set via the container
 * pointer path, inverse display mapping, pointer-capture, mount-time guard,
 * and the scroll-safety deltas from the TouchVolumeButtons pattern (commit on
 * up, movement cancel, pointercancel).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import {
  GainStrip, GAIN_LEVELS, snapToGainLevel, gainFromLevel, levelFromGain,
} from './GainStrip.jsx';

const RECT = { left: 0, top: 0, width: 220, height: 48, right: 220, bottom: 48, x: 0, y: 0 };

/**
 * This jsdom has no PointerEvent — fireEvent.pointerDown would construct a
 * plain Event and silently DROP clientX/pointerId. Build the Event ourselves
 * and assign the pointer props; React's synthetic event reads them off the
 * native event instance.
 */
function pointerEvent(type, { pointerId = 1, clientX = 0, clientY = 24 } = {}) {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(ev, { pointerId, clientX, clientY });
  return ev;
}

function renderStrip(props = {}) {
  const onGain = vi.fn();
  const utils = render(<GainStrip gain={1} onGain={onGain} {...props} />);
  const strip = utils.container.querySelector('.piano-gain-strip');
  vi.spyOn(strip, 'getBoundingClientRect').mockReturnValue(RECT);
  strip.setPointerCapture = vi.fn();
  return { ...utils, strip, onGain };
}

/** A committed tap: down + up at the same point. */
function tap(strip, clientX, pointerId = 1) {
  fireEvent(strip, pointerEvent('pointerdown', { pointerId, clientX }));
  fireEvent(strip, pointerEvent('pointerup', { pointerId, clientX }));
}

afterEach(() => vi.restoreAllMocks());

describe('gain curve helpers', () => {
  it('exposes the 11 segment levels 0..100', () => {
    expect(GAIN_LEVELS).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  });

  it('snapToGainLevel snaps to the nearest ten', () => {
    expect(snapToGainLevel(54)).toBe(50);
    expect(snapToGainLevel(56)).toBe(60);
    expect(snapToGainLevel(97)).toBe(100);
    expect(snapToGainLevel(NaN)).toBe(0);
  });

  it('gainFromLevel: exact anchors — 0 → 0, 50 → 0.1, 100 → 1', () => {
    expect(gainFromLevel(0)).toBe(0);
    expect(gainFromLevel(50)).toBeCloseTo(0.1, 10);
    expect(gainFromLevel(100)).toBeCloseTo(1, 10);
  });

  it('gainFromLevel: log curve between anchors (level 90 → 10^-0.2, level 10 → 10^-1.8)', () => {
    expect(gainFromLevel(90)).toBeCloseTo(10 ** -0.2, 10); // ≈ 0.631
    expect(gainFromLevel(10)).toBeCloseTo(10 ** -1.8, 10); // ≈ 0.0158
  });

  it('levelFromGain inverts the curve on every segment level', () => {
    for (const level of GAIN_LEVELS) {
      expect(levelFromGain(gainFromLevel(level))).toBe(level);
    }
  });

  it('levelFromGain clamps and zero-guards (gain 0 and negatives → 0)', () => {
    expect(levelFromGain(0)).toBe(0);
    expect(levelFromGain(-0.5)).toBe(0);
    expect(levelFromGain(5)).toBe(100);
    expect(levelFromGain(NaN)).toBe(0);
  });
});

describe('GainStrip component', () => {
  it('renders 11 segments with a distinct silent cell at the far left', () => {
    const { strip } = renderStrip();
    const cells = strip.querySelectorAll('.piano-gain-strip__cell');
    expect(cells.length).toBe(11);
    expect(cells[0].className).toContain('piano-gain-strip__cell--silent');
    expect(cells[0]).toHaveAccessibleName('silent');
  });

  it('tap at the midpoint sets the curve-mapped gain (level 50 → 0.1)', () => {
    const { strip, onGain } = renderStrip();
    tap(strip, 110); // 50% of 220
    expect(onGain).toHaveBeenCalledTimes(1);
    expect(onGain.mock.calls[0][0]).toBeCloseTo(0.1, 10);
  });

  it('tap at the far right sets gain 1; the far-left dead zone (≤7.5%) sets 0', () => {
    const { strip, onGain } = renderStrip();
    tap(strip, 219, 1);
    expect(onGain.mock.calls[0][0]).toBeCloseTo(1, 10);
    tap(strip, 10, 2); // 4.5% ≤ 7.5% → silence
    expect(onGain.mock.calls[1][0]).toBe(0);
  });

  it('derives the lit segments from the current gain (inverse mapping)', () => {
    const { strip } = renderStrip({ gain: 0.1 }); // level 50
    const active = strip.querySelector('.piano-gain-strip__cell.is-active');
    expect(active).toHaveAccessibleName('50%');
    expect(strip.querySelectorAll('.piano-gain-strip__cell.is-on').length).toBe(5); // 10..50
  });

  it('gain 0 lights nothing and marks the silent cell active', () => {
    const { strip } = renderStrip({ gain: 0 });
    expect(strip.querySelectorAll('.piano-gain-strip__cell.is-on').length).toBe(0);
    expect(strip.querySelector('.piano-gain-strip__cell--silent')).toHaveAttribute('aria-pressed', 'true');
  });

  it('muted renders the dimmed state but the strip stays interactive', () => {
    const { strip, onGain } = renderStrip({ muted: true });
    expect(strip.className).toContain('is-muted');
    tap(strip, 110);
    expect(onGain).toHaveBeenCalled();
  });

  it('captures the pointer on down (pattern port)', () => {
    const { strip } = renderStrip();
    fireEvent(strip, pointerEvent('pointerdown', { pointerId: 7, clientX: 110 }));
    expect(strip.setPointerCapture).toHaveBeenCalledWith(7);
  });

  it('ignores pointer events stamped before mount (BUG-04 guard)', () => {
    // Mount "in the far future": every real event's timeStamp lands before it.
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(Number.MAX_SAFE_INTEGER);
    const { strip, onGain } = renderStrip();
    nowSpy.mockRestore();
    tap(strip, 110);
    expect(onGain).not.toHaveBeenCalled();
  });

  it('a drag beyond the movement threshold is a scroll, not a tap — no gain set', () => {
    const { strip, onGain } = renderStrip();
    fireEvent(strip, pointerEvent('pointerdown', { clientX: 110, clientY: 24 }));
    fireEvent(strip, pointerEvent('pointermove', { clientX: 110, clientY: 60 })); // 36px drift
    fireEvent(strip, pointerEvent('pointerup', { clientX: 110, clientY: 60 }));
    expect(onGain).not.toHaveBeenCalled();
  });

  it('small jitter under the threshold still commits the tap', () => {
    const { strip, onGain } = renderStrip();
    fireEvent(strip, pointerEvent('pointerdown', { clientX: 110, clientY: 24 }));
    fireEvent(strip, pointerEvent('pointermove', { clientX: 114, clientY: 27 })); // 5px drift
    fireEvent(strip, pointerEvent('pointerup', { clientX: 114, clientY: 27 }));
    expect(onGain).toHaveBeenCalledTimes(1);
    expect(onGain.mock.calls[0][0]).toBeCloseTo(0.1, 10); // committed at the DOWN point
  });

  it('pointercancel (browser claimed the gesture for scrolling) drops the tap', () => {
    const { strip, onGain } = renderStrip();
    fireEvent(strip, pointerEvent('pointerdown', { clientX: 110, clientY: 24 }));
    fireEvent(strip, pointerEvent('pointercancel', {}));
    fireEvent(strip, pointerEvent('pointerup', { clientX: 110, clientY: 24 }));
    expect(onGain).not.toHaveBeenCalled();
  });
});
