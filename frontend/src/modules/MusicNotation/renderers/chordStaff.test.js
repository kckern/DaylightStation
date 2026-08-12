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

describe('renderChordStaff — relative rhythm', () => {
  const render = (columns, aspect = 3) => {
    const host = document.createElement('div');
    renderChordStaff(host, { columns, keySignature: 'C', aspect });
    return host;
  };
  // x of each drawn notehead, read off the path's opening moveto.
  const headXs = (host, selector = '.vf-stavenote') =>
    [...host.querySelectorAll(selector)].map((g) => {
      const d = g.querySelector('.vf-notehead path')?.getAttribute('d') ?? '';
      const m = d.match(/^M([-\d.]+)/);
      return m ? Math.round(Number(m[1]) * 100) / 100 : null;
    });
  const beams = (host) => host.querySelectorAll('.vf-beam').length;
  const paths = (host) => host.querySelectorAll('.vf-stavenote path').length;

  it('renders a mixed-duration flow without throwing', () => {
    const host = render([
      { midis: [60], duration: '8' },
      { midis: [64], duration: 'q' },
      { midis: [67], duration: 'h' },
    ]);
    expect(host.querySelectorAll('.vf-stavenote').length).toBe(3);
  });

  it('keeps every slot at the SAME x whatever the durations are', () => {
    // The typewriter guarantee, and the reason for the post-format snap. A column's
    // duration is rewritten retroactively the moment the next one is struck; if the
    // formatter's tick spacing were left to place the notes, that rewrite would drag
    // every column to its right and the staff would twitch under the player's hands.
    const midis = [[60], [64], [67], [72]];
    const asQuarters = midis.map((m) => ({ midis: m, duration: 'q' }));
    const mixed = [
      { midis: [60], duration: '8' },
      { midis: [64], duration: '8' },
      { midis: [67], duration: 'h' },
      { midis: [72], duration: 'q' },
    ];
    expect(headXs(render(mixed))).toEqual(headXs(render(asQuarters)));
  });

  it('places slot 1 at the same x whether it is alone or the first of four', () => {
    const alone = headXs(render([{ midis: [60], duration: '8' }]));
    const first = headXs(render([
      { midis: [60], duration: '8' },
      { midis: [64], duration: 'h' },
      { midis: [67], duration: '8' },
    ]));
    expect(first[0]).toBe(alone[0]);
  });

  it('keeps the two staves aligned at a shared column, whatever the duration', () => {
    // Treble and bass take the same duration and the same snap, so a two-hand column
    // draws as one vertical stack. Per-staff durations would give the voices different
    // tick totals and drift the staves apart column by column.
    //
    // The residual 0.73 is the bass clef's note-start sitting a hair right of the
    // treble's; it predates this and is identical on the pre-rhythm renderer. What
    // matters is that it is CONSTANT — rhythm must not widen it.
    const deltaFor = (duration) => {
      const xs = headXs(render([{ midis: [48, 72], duration }]));
      expect(xs).toHaveLength(2);
      return xs[1] - xs[0];
    };
    const deltas = ['8', 'q', 'h'].map(deltaFor);
    expect(new Set(deltas).size).toBe(1);
    expect(Math.abs(deltas[0])).toBeLessThan(1);
  });

  it('beams a run of consecutive eighths', () => {
    expect(beams(render([
      { midis: [60], duration: '8' },
      { midis: [62], duration: '8' },
      { midis: [64], duration: '8' },
    ]))).toBe(1);
  });

  it('breaks the beam on a column that is not an eighth', () => {
    expect(beams(render([
      { midis: [60], duration: '8' },
      { midis: [62], duration: '8' },
      { midis: [64], duration: 'q' },
      { midis: [65], duration: '8' },
      { midis: [67], duration: '8' },
    ]))).toBe(2);
  });

  it('does not beam a lone eighth', () => {
    expect(beams(render([
      { midis: [60], duration: '8' },
      { midis: [64], duration: 'q' },
    ]))).toBe(0);
  });

  it('breaks the beam across a slot this staff does not play', () => {
    // Left hand, right hand, left hand: the treble has a hole in the middle, so its
    // two eighths are not consecutive and must not be joined over the gap.
    expect(beams(render([
      { midis: [72], duration: '8' },
      { midis: [40], duration: '8' },
      { midis: [74], duration: '8' },
    ]))).toBe(0);
  });

  it('gives a lone eighth a flag (it is drawn as an eighth, not a quarter)', () => {
    const eighth = render([{ midis: [60], duration: '8' }]);
    const quarter = render([{ midis: [60], duration: 'q' }]);
    expect(paths(eighth)).toBeGreaterThan(paths(quarter));
  });

  it('defaults a column with no duration to a quarter', () => {
    expect(headXs(render([{ midis: [60] }]))).toEqual(headXs(render([{ midis: [60], duration: 'q' }])));
    expect(paths(render([{ midis: [60] }]))).toBe(paths(render([{ midis: [60], duration: 'q' }])));
  });

  it('leaves the single-chord form (the flashcard face) on quarters', () => {
    const host = document.createElement('div');
    renderChordStaff(host, { notes: new Map([[60, {}], [64, {}]]), keySignature: 'C', aspect: 1.7 });
    const asQuarter = document.createElement('div');
    renderChordStaff(asQuarter, { notes: new Map([[60, {}], [64, {}]]), keySignature: 'C', aspect: 1.7 });
    expect(host.querySelectorAll('.vf-beam').length).toBe(0);
    expect(paths(host)).toBe(paths(asQuarter));
  });

  it('holds the fixed frame across durations (rhythm cannot move the staff)', () => {
    const box = (duration) => render([{ midis: [60], duration }])
      .querySelector('svg').getAttribute('viewBox');
    expect(new Set(['8', 'q', 'h'].map(box)).size).toBe(1);
  });
});

describe('renderChordStaff — beams stay inside the fixed frame', () => {
  // jsdom has no getBBox, so ink can't be measured the way the sweep does
  // (tests/_infrastructure/harnesses/chord-staff-ink-sweep.mjs). Path coordinates can
  // be, and that is enough to hold the specific regression the sweep found: letting
  // Beam pick a majority stem direction flipped stems away from the staff on a low
  // bass run and dropped the beam ~11 units below the frame.
  const coordsOutsideFrame = (host) => {
    const svg = host.querySelector('svg');
    const [, vy, , vh] = svg.getAttribute('viewBox').split(' ').map(Number);
    const bad = [];
    for (const p of svg.querySelectorAll('path')) {
      const nums = (p.getAttribute('d') ?? '').match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
      for (let i = 1; i < nums.length; i += 2) {
        if (nums[i] < vy || nums[i] > vy + vh) bad.push(nums[i]);
      }
    }
    return bad;
  };
  const renderFlow = (midis, duration, aspect) => {
    const host = document.createElement('div');
    renderChordStaff(host, {
      columns: Array.from({ length: 8 }, (_, i) => ({ midis: midis.map((m) => m + i), duration })),
      keySignature: 'C',
      aspect,
    });
    return host;
  };

  it('keeps a low two-hand run of eighths inside the frame', () => {
    // The exact shape the sweep reported clipping at 268.9 against a 258 frame floor.
    expect(coordsOutsideFrame(renderFlow([35, 47, 75, 78, 82], '8', 2.6666666666666665))).toEqual([]);
  });

  it('keeps a low bass triad run of eighths inside the frame', () => {
    expect(coordsOutsideFrame(renderFlow([21, 25, 28], '8', 2.6666666666666665))).toEqual([]);
  });

  it('holds for quarters and halves too', () => {
    expect(coordsOutsideFrame(renderFlow([35, 47, 75, 78, 82], 'q', 3.5))).toEqual([]);
    expect(coordsOutsideFrame(renderFlow([35, 47, 75, 78, 82], 'h', 3.5))).toEqual([]);
  });
});
