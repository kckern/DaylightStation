import { describe, it, expect } from 'vitest';
import { midiToVexKey, renderChordStaff, computeChordStaffLayout } from './chordStaff.js';

describe('computeChordStaffLayout', () => {
  const LOGICAL_H = 210; // TOP_ROOM(52) + STAFF_GAP(66) + BASS_STAFF_H(40) + BOTTOM_ROOM(52)
  const MAX_STAVE_ASPECT = 1.7;
  const MAX_STAVE_W = Math.round(LOGICAL_H * MAX_STAVE_ASPECT) - 16; // round(357) - PAD*2 = 341

  it('falls back to content-sized stave when no aspect given', () => {
    const { staveW, logicalW, logicalH } = computeChordStaffLayout(0, null);
    expect(staveW).toBe(44 + 0 * 10 + 40);
    expect(logicalW).toBe(staveW + 16); // PAD * 2
    expect(logicalH).toBe(LOGICAL_H);
  });

  it('widens the stave to track a moderate wide box (under the cap)', () => {
    const aspect = 550 / 500; // 1.1, below MAX_STAVE_ASPECT so it tracks the aspect
    const { staveW, logicalW, logicalH } = computeChordStaffLayout(0, aspect);
    // target = round(210*1.1) - 16 = 231 - 16 = 215 (< maxStaveW 341, so uncapped)
    expect(staveW).toBe(215);
    expect(logicalW / logicalH).toBeCloseTo(aspect, 1); // 231/210 ≈ 1.1
  });

  it('never goes below the content minimum (tall/narrow boxes)', () => {
    const { staveW } = computeChordStaffLayout(4, 0.2);
    expect(staveW).toBe(44 + 4 * 10 + 40);
  });

  it('caps ultra-wide boxes at MAX_STAVE_ASPECT (staff centers, not edge-to-edge)', () => {
    const aspect = 10;
    const { staveW, logicalW, logicalH } = computeChordStaffLayout(0, aspect);
    // Upper clamp: staveW pins to maxStaveW so the viewBox aspect stops at the cap
    // (→ narrower than the pane, and `meet` centers it with side air).
    expect(staveW).toBe(MAX_STAVE_W); // 341
    expect(logicalW).toBe(MAX_STAVE_W + 16); // 357
    expect(logicalW / logicalH).toBeCloseTo(MAX_STAVE_ASPECT, 1); // 357/210 ≈ 1.70
  });

  it('caps at maxStaveW regardless of accidental count', () => {
    // Even with accidentals bumping minStaveW, a very wide box still pins to the cap.
    const { staveW } = computeChordStaffLayout(4, 20);
    expect(staveW).toBe(MAX_STAVE_W); // 341, well above minStaveW (44+40+40=124)
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

  it('renders a HIGH treble chord without error (auto_stem stems down)', () => {
    // High noteheads sit above the staff; auto_stem points the stem DOWN toward the
    // staff so the chord stays within TOP_ROOM instead of clipping.
    const host = mount(new Map([[83, {}], [86, {}], [89, {}]]));
    const svg = host.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg.querySelectorAll('path').length).toBeGreaterThan(3);
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
