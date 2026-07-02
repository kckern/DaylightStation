import { describe, it, expect } from 'vitest';
import { LINE_COLORS, contrastRatio, channelDistance, laneColorVars } from './lineColors.js';

const FORBIDDEN = ['#6ab8ff', '#51cf66', '#ffd43b', '#ff922b', '#ff6b6b', '#21e6ff', '#ff2d95'];

// Audit UX §6.2: the race screen renders on $cg-bg (#0a0a14).
const CG_BG = '#0a0a14';
// Reserved chrome cyan — no rider lane may read as "basically this hue".
const CHROME_CYAN = '#21e6ff';
// Empirically: the OLD lane-1 cyan (#4dd0e1, the exact bug this task fixes)
// sits 96 channel-units from chrome cyan; every other lane in the palette
// sits comfortably further away. 60 gives real margin without being so loose
// it'd pass a near-duplicate.
const MIN_CYAN_DISTANCE = 60;

describe('LINE_COLORS (synthwave rider palette)', () => {
  it('has at least 6 distinct colors', () => {
    expect(LINE_COLORS.length).toBeGreaterThanOrEqual(6);
    expect(new Set(LINE_COLORS.map((c) => c.toLowerCase())).size).toBe(LINE_COLORS.length);
  });
  it('does not reuse any HR-zone or reserved-chrome color', () => {
    const lc = LINE_COLORS.map((c) => c.toLowerCase());
    FORBIDDEN.forEach((f) => expect(lc).not.toContain(f.toLowerCase()));
  });

  // audit UX §6.2 — every lane must clear AA contrast against the race-screen
  // background, and no lane may read as "the same cyan" as the reserved
  // chrome accent (the exact rider-1 bug this task fixes).
  it('every lane clears WCAG AA (4.5:1) contrast against $cg-bg', () => {
    LINE_COLORS.forEach((color) => {
      expect(contrastRatio(color, CG_BG)).toBeGreaterThanOrEqual(4.5);
    });
  });
  it('no lane sits within trivial channel distance of the reserved chrome cyan', () => {
    LINE_COLORS.forEach((color) => {
      expect(channelDistance(color, CHROME_CYAN)).toBeGreaterThan(MIN_CYAN_DISTANCE);
    });
  });
  it('lane 1 moved off cyan onto the reserved go/success green ($cg-lane-1)', () => {
    expect(LINE_COLORS[0].toLowerCase()).toBe('#5dff9b');
  });
});

describe('contrastRatio', () => {
  it('is 1 for identical colors', () => {
    expect(contrastRatio('#5dff9b', '#5dff9b')).toBeCloseTo(1, 5);
  });
  it('is symmetric', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(contrastRatio('#000000', '#ffffff'), 5);
  });
  it('is the max (21:1) for pure black vs pure white', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0);
  });
});

describe('channelDistance', () => {
  it('is 0 for identical colors', () => {
    expect(channelDistance('#5dff9b', '#5dff9b')).toBe(0);
  });
  it('is the full 765 for opposite-corner colors', () => {
    expect(channelDistance('#000000', '#ffffff')).toBe(765);
  });
});

describe('laneColorVars', () => {
  it('emits the full 6-lane palette when no riderIds are given', () => {
    const vars = laneColorVars();
    expect(vars['--cg-lane-0']).toBe(LINE_COLORS[0]);
    expect(vars['--cg-lane-5']).toBe(LINE_COLORS[5]);
    expect(Object.keys(vars)).toHaveLength(6);
  });
  it('emits one var per rider, wrapping the palette past 6 riders', () => {
    const riderIds = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const vars = laneColorVars(riderIds);
    expect(Object.keys(vars)).toHaveLength(7);
    expect(vars['--cg-lane-6']).toBe(LINE_COLORS[0]); // wraps
  });
  it('is index-keyed, matching the LINE_COLORS[idx % length] convention', () => {
    const vars = laneColorVars(['x', 'y']);
    expect(vars).toEqual({ '--cg-lane-0': LINE_COLORS[0], '--cg-lane-1': LINE_COLORS[1] });
  });
});
