import { describe, it, expect } from 'vitest';
import { midiToVexKey, renderChordStaff, computeChordStaffLayout } from './chordStaff.js';

describe('computeChordStaffLayout', () => {
  const FRAME_H = 238;    // FRAME_BOTTOM(258) - FRAME_TOP(20)
  const FRAME_PAD_X = 38; // PAD(8) + FRAME_RIGHT_PAD(16) - FRAME_LEFT(-14)
  const MAX_STAVE_ASPECT = 3;
  const MAX_STAVE_W = Math.round(FRAME_H * MAX_STAVE_ASPECT) - FRAME_PAD_X; // 714 - 38 = 676
  const MIN_STAVE_W = 44 + 7 * 10 + 88; // widest key signature + the note-area floor

  it('falls back to content-sized stave when no aspect given', () => {
    const { staveW, viewW, viewH } = computeChordStaffLayout(null);
    expect(staveW).toBe(MIN_STAVE_W);
    expect(viewW).toBe(staveW + FRAME_PAD_X);
    expect(viewH).toBe(FRAME_H);
  });

  it('widens the stave to track a moderate wide box (under the cap)', () => {
    const aspect = 550 / 500; // 1.1, below MAX_STAVE_ASPECT so it tracks the aspect
    const { staveW, viewW, viewH } = computeChordStaffLayout(aspect);
    // target = round(238*1.1) - 38 = 262 - 38 = 224 (> the 202 floor, < the 676 cap)
    expect(staveW).toBe(224);
    expect(viewW / viewH).toBeCloseTo(aspect, 1); // 262/238 ≈ 1.101
  });

  it('never goes below the content minimum (tall/narrow boxes)', () => {
    const { staveW } = computeChordStaffLayout(0.2);
    expect(staveW).toBe(MIN_STAVE_W);
  });

  it('caps ultra-wide boxes at MAX_STAVE_ASPECT (staff centers, not edge-to-edge)', () => {
    const aspect = 10;
    const { staveW, viewW, viewH } = computeChordStaffLayout(aspect);
    // Upper clamp: staveW pins to maxStaveW so the viewBox aspect stops at the cap
    // (→ narrower than the pane, and `meet` centers it with side air).
    expect(staveW).toBe(MAX_STAVE_W); // 676
    expect(viewW).toBe(MAX_STAVE_W + FRAME_PAD_X); // 714
    expect(viewW / viewH).toBeCloseTo(MAX_STAVE_ASPECT, 1); // 714/238 = 3
  });

  it('caps at maxStaveW on very wide boxes', () => {
    const { staveW } = computeChordStaffLayout(20);
    expect(staveW).toBe(MAX_STAVE_W); // 676, well above the content floor
  });

  it('tolerates garbage aspect values', () => {
    for (const a of [NaN, Infinity, -1, 0]) {
      expect(computeChordStaffLayout(a).staveW).toBe(MIN_STAVE_W);
    }
  });

  it('is a pure function of the box aspect — neither chord nor key can reach it', () => {
    // The staff-is-fixed contract in one assertion: layout takes no note and no key
    // input at all, so nothing being played can move or resize the frame.
    expect(computeChordStaffLayout.length).toBe(1);
  });

  it('keeps the frame height constant across every aspect (vertical never breathes)', () => {
    const heights = [0.2, 0.6, 1, 1.7, 2.67, 10].map((a) => computeChordStaffLayout(a).viewH);
    expect(new Set(heights)).toEqual(new Set([FRAME_H]));
  });

  it('reserves the measured worst-case ink extents (31 → 249.7, left −6)', () => {
    // Bounds come from a 44,694-render Chrome sweep (see chordStaff.js). Guard them
    // here so a future tweak to the frame cannot silently start clipping notes.
    const { viewX, viewY, viewH } = computeChordStaffLayout(2);
    expect(viewY).toBeLessThanOrEqual(31);        // worst ink top
    expect(viewY + viewH).toBeGreaterThanOrEqual(249.7); // worst ink bottom
    expect(viewX).toBeLessThanOrEqual(-6);        // worst ink left (the brace)
  });
});

describe('midiToVexKey — key-signature-aware spelling', () => {
  it('spells naturals with the right letter and octave (C4 = c/4)', () => {
    expect(midiToVexKey(60, 'C')).toBe('c/4'); // middle C
    expect(midiToVexKey(48, 'C')).toBe('c/3');
    expect(midiToVexKey(72, 'C')).toBe('c/5');
    expect(midiToVexKey(64, 'C')).toBe('e/4');
  });

  it('spells chromatic notes by scale degree, not a fixed sharp table', () => {
    expect(midiToVexKey(61, 'C')).toBe('c#/4'); // ♯1 of C leans sharp
    expect(midiToVexKey(66, 'G')).toBe('f#/4'); // F♯ is IN the key of G
    expect(midiToVexKey(70, 'C')).toBe('bb/4'); // ♭7 of C leans flat — B♭, not A♯
    expect(midiToVexKey(70, 'B')).toBe('a#/4'); // …but A♯ is in the key of B
  });

  it('spells black keys with flats in flat keys', () => {
    expect(midiToVexKey(70, 'F')).toBe('bb/4');  // Bb in F major
    expect(midiToVexKey(61, 'Db')).toBe('db/4'); // Db
    expect(midiToVexKey(63, 'Eb')).toBe('eb/4'); // Eb
  });

  it('corrects the octave when the spelling crosses an octave boundary', () => {
    // Only reachable via a key that spells pc 11 as C♭ or pc 0 as B♯; guard the
    // arithmetic so such a spelling lands in the right octave rather than a 7th away.
    expect(midiToVexKey(71, 'C')).toBe('b/4');
    expect(midiToVexKey(72, 'C')).toBe('c/5');
  });

  it('carries the TRUE accidental (display is decided per column)', () => {
    // An in-key F# still spells as f# here; suppression of the redundant sharp is
    // VexFlow's job at draw time, not the speller's.
    expect(midiToVexKey(66, 'D')).toBe('f#/4');
    // A B-natural in F major still spells b/4 (natural); chordNote adds the ♮.
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

  it('keeps a HIGH treble chord inside the viewBox (auto_stem, no top clip)', () => {
    // High noteheads sit above the staff; auto_stem points the stem DOWN toward the
    // staff so the chord stays within the frame's top room instead of clipping.
    const host = mount(new Map([[83, {}], [86, {}], [89, {}]]));
    const svg = host.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg.querySelectorAll('path').length).toBeGreaterThan(3);
    const vb = svg.getAttribute('viewBox').split(' ').map(Number);
    expect(vb[3]).toBe(238); // the fixed frame height
    // No drawn element escapes far above the top of the frame (would signal a top clip).
    for (const el of svg.querySelectorAll('[y]')) {
      const y = Number(el.getAttribute('y'));
      if (Number.isFinite(y)) expect(y).toBeGreaterThan(-10);
    }
  });

  it('is fluid: a viewBox + preserveAspectRatio lets the browser fit & center it', () => {
    // Sizing is CSS/SVG-driven (no JS px-scale), so it survives any DPR/resolution
    // without overflowing or clipping — the bug the px-scale version hit on the tablet.
    const host = mount(new Map([[60, {}]]));
    const svg = host.querySelector('svg');
    expect(svg.getAttribute('viewBox')).toBe('-14 20 240 238');
    expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
    expect(svg.getAttribute('width')).toBe('100%');
    expect(svg.getAttribute('height')).toBe('100%');
  });

  it('draws fewer columns in a narrow pane rather than clipping them', () => {
    // The frame is fixed, so a column that does not fit is not squeezed — it is cut off.
    // A narrow staff therefore shows fewer, readable columns. (Eight chords genuinely do
    // not fit a sidebar staff; verified by the ink sweep harness.)
    const drawn = (aspect) => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const columns = Array.from({ length: 8 }, (_, i) => [60 + i, 64 + i, 67 + i]);
      renderChordStaff(host, { columns, keySignature: 'C', aspect });
      return host.querySelectorAll('.vf-stavenote').length;
    };
    const wide = drawn(560 / 210);
    const narrow = drawn(300 / 220);
    expect(wide).toBeGreaterThan(narrow);
    expect(narrow).toBeGreaterThanOrEqual(1);
  });

  it('does not change the column count when the key signature changes', () => {
    // The displayed key drifts as you play. If the slot count were measured from the
    // real key-signature width, the flow would gain and lose a column on a modulation.
    const drawn = (key) => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const columns = Array.from({ length: 8 }, (_, i) => [60 + i]);
      renderChordStaff(host, { columns, keySignature: key, aspect: 560 / 210 });
      return host.querySelectorAll('.vf-stavenote').length;
    };
    const counts = ['C', 'G', 'F#', 'Db', 'Gb'].map(drawn);
    expect(new Set(counts).size).toBe(1);
  });

  it('THE CONTRACT: the viewBox is identical for every chord (staff never moves)', () => {
    // One frame, whatever is played: silence, a middle triad, the lowest and highest
    // keys together (both ottava markers), a 12-note cluster. If any of these differ,
    // the staff has started breathing again.
    const chords = [
      [],
      [60, 64, 67],
      [21],
      [108],
      [21, 108],
      [36, 96],
      [60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71],
    ];
    const boxes = chords.map((midis) =>
      mount(new Map(midis.map((m) => [m, {}])), 'C').querySelector('svg').getAttribute('viewBox')
    );
    expect(new Set(boxes).size).toBe(1);
  });

  // Accidental glyphs carry no class of their own (Accidental.draw paints a bare
  // glyph), so they can't be selected directly. The same pitches in two keys differ
  // by nothing BUT their accidentals, which makes the path-count delta the glyph count.
  const inkPaths = (midiColumns, key) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    // A real pane aspect: the minimum-width staff only has room for one column, and
    // these cases need to see two.
    renderChordStaff(host, { columns: midiColumns, keySignature: key, aspect: 560 / 210 });
    return host.querySelectorAll('.vf-stavenote path').length;
  };

  it('marks out-of-key notes and leaves in-key notes bare', () => {
    expect(inkPaths([[66]], 'C') - inkPaths([[66]], 'G')).toBe(1); // F♯ needs ♯ in C
    expect(inkPaths([[65]], 'G') - inkPaths([[65]], 'C')).toBe(1); // F♮ needs ♮ in G
  });

  it('does not mistake B natural for B flat', () => {
    // Regression: reading the accidental with spelling.includes('b') treats the LETTER
    // b as a flat, so every B natural picked up a spurious ♭.
    expect(inkPaths([[71]], 'C')).toBe(inkPaths([[72]], 'C')); // B♮ as bare as C♮
    expect(inkPaths([[71]], 'Bb') - inkPaths([[71]], 'C')).toBe(1); // …but ♮ in B♭ major
  });

  it('re-prints an accidental on every column (live mirror, not measure semantics)', () => {
    // A score prints the sharp once and lets it carry; a live display must not, or the
    // second F♯ reads as a different note than the first.
    expect(inkPaths([[66], [66]], 'C') - inkPaths([[66], [66]], 'G')).toBe(2);
  });

  it('holds the frame across key signatures too (only the accidentals change)', () => {
    const notes = new Map([[60, {}], [64, {}], [67, {}]]);
    const boxes = ['C', 'G', 'F#', 'Db', 'Gb'].map(
      (k) => mount(notes, k).querySelector('svg').getAttribute('viewBox')
    );
    expect(new Set(boxes).size).toBe(1);
  });
});
