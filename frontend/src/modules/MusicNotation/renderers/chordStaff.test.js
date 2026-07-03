import { describe, it, expect } from 'vitest';
import { midiToVexKey, renderChordStaff, computeChordStaffLayout } from './chordStaff.js';

describe('computeChordStaffLayout', () => {
  const LOGICAL_H = 192; // TOP_ROOM + STAFF_GAP + BASS_STAFF_H + BOTTOM_ROOM

  it('falls back to content-sized stave when no aspect given', () => {
    const { staveW, logicalW, logicalH } = computeChordStaffLayout(0, null);
    expect(staveW).toBe(44 + 0 * 10 + 40);
    expect(logicalW).toBe(staveW + 16); // PAD * 2
    expect(logicalH).toBe(LOGICAL_H);
  });

  it('widens the stave to fill a wide box', () => {
    const aspect = 550 / 500;
    const { logicalW, logicalH } = computeChordStaffLayout(0, aspect);
    expect(logicalW / logicalH).toBeCloseTo(aspect, 1);
  });

  it('never goes below the content minimum (tall/narrow boxes)', () => {
    const { staveW } = computeChordStaffLayout(4, 0.2);
    expect(staveW).toBe(44 + 4 * 10 + 40);
  });

  it('clamps ultra-wide boxes so staves stay musical', () => {
    const { staveW } = computeChordStaffLayout(0, 10);
    expect(staveW).toBeLessThanOrEqual(560);
  });

  it('tolerates garbage aspect values', () => {
    for (const a of [NaN, Infinity, -1, 0]) {
      expect(computeChordStaffLayout(0, a).staveW).toBe(84);
    }
  });
});

describe('midiToVexKey — key-signature-aware spelling', () => {
  it('spells naturals with the right letter and octave (C4 = c/4)', () => {
    expect(midiToVexKey(60, 'C')).toBe('c/4'); // middle C
    expect(midiToVexKey(48, 'C')).toBe('c/3');
    expect(midiToVexKey(72, 'C')).toBe('c/5');
    expect(midiToVexKey(64, 'C')).toBe('e/4');
  });

  it('spells black keys with sharps in sharp/neutral keys', () => {
    expect(midiToVexKey(61, 'C')).toBe('c#/4'); // C#
    expect(midiToVexKey(66, 'G')).toBe('f#/4'); // F# (in key of G)
    expect(midiToVexKey(70, 'C')).toBe('a#/4'); // A#
  });

  it('spells black keys with flats in flat keys', () => {
    expect(midiToVexKey(70, 'F')).toBe('bb/4');  // Bb in F major
    expect(midiToVexKey(61, 'Db')).toBe('db/4'); // Db
    expect(midiToVexKey(63, 'Eb')).toBe('eb/4'); // Eb
  });

  it('carries the TRUE accidental (display is decided by applyAccidentals)', () => {
    // An in-key F# still spells as f# here; suppression of the redundant sharp is
    // VexFlow's job at draw time, not the speller's.
    expect(midiToVexKey(66, 'D')).toBe('f#/4');
    // A B-natural in F major still spells b/4 (natural); applyAccidentals adds the ♮.
    expect(midiToVexKey(71, 'F')).toBe('b/4');
  });
});

describe('renderChordStaff — VexFlow grand staff', () => {
  const mount = (notes, key = 'C', width = 300) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    Object.defineProperty(host, 'clientWidth', { value: width, configurable: true });
    renderChordStaff(host, { notes, keySignature: key });
    return host;
  };

  it('draws an SVG even with no notes (empty grand staff stays visible)', () => {
    const host = mount(new Map());
    const svg = host.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg.querySelectorAll('path,rect,line').length).toBeGreaterThan(0);
  });

  it('renders a chord (treble + bass) in dark ink, not theme foreground', () => {
    const host = mount(new Map([[60, {}], [64, {}], [67, {}], [48, {}]]));
    const svg = host.querySelector('svg');
    expect(svg).toBeTruthy();
    // Ink is set explicitly on the render context so the staff reads black on a
    // light card (no reliance on currentColor inheriting a near-white theme fg).
    expect(svg.innerHTML).toContain('1a1a1a');
    expect(svg.querySelectorAll('path').length).toBeGreaterThan(3); // brace + staff + notes
  });

  it('is fluid: a viewBox + preserveAspectRatio lets the browser fit & center it', () => {
    // Sizing is CSS/SVG-driven (no JS px-scale), so it survives any DPR/resolution
    // without overflowing or clipping — the bug the px-scale version hit on the tablet.
    const host = mount(new Map([[60, {}]]));
    const svg = host.querySelector('svg');
    expect(svg.getAttribute('viewBox')).toMatch(/^0 0 \d+ \d+$/);
    expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
    expect(svg.getAttribute('width')).toBe('100%');
    expect(svg.getAttribute('height')).toBe('100%');
  });
});
