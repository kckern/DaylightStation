import { describe, it, expect, vi } from 'vitest';
import { Stroke } from 'vexflow';
import { midiToVexKey, renderChordStaff, computeChordStaffLayout, chordStaffWindow } from "./chordStaff.js";

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

  it('reserves the measured worst-case ink extents (20.5 → 254.2, left −6)', () => {
    // Bounds come from a 151,944-render Chrome sweep (see chordStaff.js). Guard them
    // here so a future tweak to the frame cannot silently start clipping notes.
    const { viewX, viewY, viewH } = computeChordStaffLayout(2);
    expect(viewY).toBeLessThanOrEqual(20.5);      // worst ink top
    expect(viewY + viewH).toBeGreaterThanOrEqual(254.2); // worst ink bottom
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

  it('gives a quarter the same width in every key signature', () => {
    // The displayed key drifts as you play. The quarter's width comes from the box alone,
    // so a modulation can take room from the line (seven sharps are wider than none) but
    // never re-spaces it: eight quarters fill a C-major line, and the head-to-head step
    // is identical in every key.
    const drawn = (key) => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const columns = Array.from({ length: 16 }, () => ({ midis: [67], duration: 'q' }));
      renderChordStaff(host, { columns, keySignature: key, aspect: 560 / 210 });
      // The first path of a notehead group is the head (an accidental follows it).
      const xs = [...host.querySelectorAll('g.vf-notehead')]
        .map((g) => Number(/^M\s*([-\d.]+)/.exec(g.querySelector(':scope > path').getAttribute('d'))[1]));
      return { count: xs.length, step: Math.round((xs[1] - xs[0]) * 100) / 100 };
    };
    const byKey = ['C', 'G', 'F#', 'Db', 'Gb'].map(drawn);
    expect(byKey[0].count).toBe(8);
    expect(new Set(byKey.map((k) => k.step)).size).toBe(1);
    for (const k of byKey) expect(k.count).toBeGreaterThanOrEqual(6);
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

  it("moves nothing to the LEFT of a column whose duration changes", () => {
    // The typewriter guarantee. A column's x depends only on the columns before it, so
    // rewriting one column's duration (it happens the moment the next is struck) can
    // only move what is to its right — and here, the columns before it stay put.
    const at = (d) => headXs(render([
      { midis: [60], duration: '8' },
      { midis: [64], duration: 'q' },
      { midis: [67], duration: d },
      { midis: [72], duration: '8' },
    ]));
    const [e, q, h] = ['8', 'q', 'h'].map(at);
    expect(q.slice(0, 3)).toEqual(e.slice(0, 3));
    expect(h.slice(0, 3)).toEqual(e.slice(0, 3));
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

  it('beams a run that crosses the middle line as ONE group, not broken at each stem flip', () => {
    // E4 (stem up on its own) through D5 (stem down on its own): the old rule broke the
    // beam wherever the stems disagreed, leaving a melody as a row of lone flags.
    expect(beams(render([
      { midis: [64], duration: '8' },
      { midis: [67], duration: '8' },
      { midis: [71], duration: '8' },
      { midis: [74], duration: '8' },
    ]))).toBe(1);
  });

  // Every (x, y) pair of a path's absolute coordinates. VexFlow's glyph outlines and
  // beam polygons are drawn with absolute M/L/Q/C commands, so the pairs bound the ink.
  const pathPoints = (p) => {
    const nums = (p.getAttribute('d') ?? '').match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    const pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    return pts;
  };
  // Which side of its noteheads the (single) beam lies on: 'above' (stems up), 'below'
  // (stems down), or 'mixed' if it lies above some heads and below others. Read from
  // geometry, because a beamed note draws no stem of its own (the Beam draws them), so
  // there is no .vf-stem to read. The beam slopes, so each head is compared with the
  // beam's height AT that head's x (the polygon's ends, interpolated).
  const beamSide = (host) => {
    const pts = [...host.querySelectorAll('.vf-beam path')].flatMap((p) => pathPoints(p));
    if (!pts.length) return 'none';
    const x0 = Math.min(...pts.map(([x]) => x));
    const x1 = Math.max(...pts.map(([x]) => x));
    const yAt = (edge) => {
      const ys = pts.filter(([x]) => x === edge).map(([, y]) => y);
      return ys.reduce((a, b) => a + b, 0) / ys.length;
    };
    const [y0, y1] = [yAt(x0), yAt(x1)];
    const beamY = (x) => y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1);
    const sides = new Set([...host.querySelectorAll('g.vf-notehead')].map((g) => {
      const [hx, hy] = pathPoints(g.querySelector(':scope > path'))[0];
      return beamY(hx) < hy ? 'above' : 'below';
    }));
    return sides.size === 1 ? [...sides][0] : 'mixed';
  };

  it('gives every note of a beamed group the same stem direction', () => {
    // One direction for the group means the beam lies wholly on one side of every head.
    const host = render([
      { midis: [64], duration: '8' },
      { midis: [72], duration: '8' },
      { midis: [76], duration: '8' },
    ]);
    expect(beams(host)).toBe(1);
    expect(['above', 'below']).toContain(beamSide(host));
  });

  it("decides a group's direction from its first two columns: appending never flips drawn stems", () => {
    // D5 B4 G4 averages ON the middle line → stems down. Adding another G4 drags a
    // whole-run average below it and used to flip the three stems already drawn, and
    // the beam. (G4, not E4: an E4 stemmed down now leaves the group, see below.)
    const run = [[74], [71], [67]].map((midis) => ({ midis, duration: '8' }));
    expect(beamSide(render(run))).toBe('below');
    const longer = render([...run, { midis: [67], duration: '8' }]);
    expect(beamSide(longer)).toBe('below');
    expect(beams(longer)).toBe(1);
  });

  // y of every beam polygon drawn (these cases play one staff only).
  const beamYs = (host) => [...host.querySelectorAll('.vf-beam path')]
    .flatMap((p) => pathPoints(p).map(([, y]) => y));
  const BASS_TOP_LINE = 164;   // TOP_ROOM 58 + STAFF_GAP 66 + 4 spaces of headroom
  const TREBLE_BOTTOM_LINE = 138;

  it("keeps a treble beam out of the bass staff: a low note stemmed down leaves the group", () => {
    // D5 B4 then E4: the group stems down, and E4's stem would carry the beam ~9 units
    // into the bass staff's lines. E4 keeps its own stem and flag instead.
    const host = render([[74], [71], [64]].map((midis) => ({ midis, duration: '8' })));
    expect(beams(host)).toBe(1);
    expect(Math.max(...beamYs(host))).toBeLessThanOrEqual(BASS_TOP_LINE);
    // The replay case: wide treble chords reaching down to D4/E♭4 under high notes.
    const wide = render([[82, 63], [82, 80, 62], [82, 81, 63]].map((midis) => ({ midis, duration: '8' })));
    expect(beamYs(wide).every((y) => y <= BASS_TOP_LINE)).toBe(true);
  });

  it("turns a lone wide treble chord's stem up rather than down into the bass staff", () => {
    // E♭4 under A5 B♭5: auto_stem points down from the top head, past E♭4 and on into
    // the bass staff. On its own (no beam) it now stems up.
    const host = render([{ midis: [63, 81, 82], duration: '8' }]);
    const stemYs = [...host.querySelectorAll('.vf-stavenote .vf-stem path')]
      .flatMap((p) => pathPoints(p).map(([, y]) => y));
    expect(stemYs.length).toBeGreaterThan(0);
    expect(Math.max(...stemYs)).toBeLessThanOrEqual(BASS_TOP_LINE);
  });

  it('leaves an 8vb-marked note out of the beam, so its label never lands on a beam', () => {
    // D3 | a wide left-hand chord down to C2 (drawn an octave up under 8vb, stemmed
    // down on its own like the rest of the group) | D3 E3. The replay case (19): the
    // chord's 8vb label sat on the group's beam. Now the marked chord splits the run.
    const host = render([[50], [36, 48, 53, 55], [50], [52]].map((midis) => ({ midis, duration: '8' })));
    expect(beams(host)).toBe(1);
    const labels = [...host.querySelectorAll('text')].filter((t) => /^(8|15)v?m?[ab]$/.test(t.textContent));
    expect(labels.length).toBe(1);
    const beamBoxes = [...host.querySelectorAll('.vf-beam path')].map((p) => {
      const q = pathPoints(p);
      return { x0: Math.min(...q.map(([x]) => x)), x1: Math.max(...q.map(([x]) => x)),
        y0: Math.min(...q.map(([, y]) => y)), y1: Math.max(...q.map(([, y]) => y)) };
    });
    for (const t of labels) {
      const x = Number(t.getAttribute('x'));
      const y = Number(t.getAttribute('y'));
      // The label's box: ~20 units of text right of x, ~10 above its baseline.
      for (const b of beamBoxes) {
        const hit = x < b.x1 && b.x0 < x + 20 && y - 10 < b.y1 && b.y0 < y;
        expect(hit).toBe(false);
      }
      // ...and the marked note itself is not under any beam: no beam spans its x.
      for (const b of beamBoxes) expect(x >= b.x0 && x <= b.x1).toBe(false);
    }
  });

  it('keeps a bass beam out of the treble staff: a high bass note stemmed up leaves the group', () => {
    // C3 D3 E3 F3 G3 stems up; G3's stem would reach into the treble staff's lines.
    const host = render([[48], [50], [52], [53], [55]].map((midis) => ({ midis, duration: '8' })));
    expect(beams(host)).toBe(1);
    expect(Math.min(...beamYs(host))).toBeGreaterThanOrEqual(TREBLE_BOTTOM_LINE);
  });

  // Stem side of one lone (unbeamed) note group: 'up' when its stem ends above its head.
  const stemSide = (g) => {
    const stem = pathPoints(g.querySelector('.vf-stem path'));
    const head = pathPoints(g.querySelector('.vf-notehead > path')).map(([, y]) => y);
    const headMid = (Math.min(...head) + Math.max(...head)) / 2;
    const stemMid = stem.reduce((a, [, y]) => a + y, 0) / stem.length;
    return stemMid < headMid ? 'up' : 'down';
  };

  it('a hold promotion shows its half but leaves its neighbours stems and beam as drawn', () => {
    // Bass C3 D3 F3 (+ the newest) beam stems-up. C3 is held into a half: before, it left
    // the run and D3–F3 re-voted their direction from their own first two — and flipped.
    const tail = [{ midis: [50], duration: '8' }, { midis: [53], duration: '8' }, { midis: [52], duration: '8' }];
    const plain = render([{ midis: [48], duration: '8' }, ...tail]);
    const promoted = render([{ midis: [48], duration: 'h', widthDuration: '8' }, ...tail]);
    expect(beamSide(plain)).toBe('above');
    const heads = (host) => [...host.querySelectorAll('g.vf-notehead')].map((g) => pathPoints(g.querySelector(':scope > path'))[0]);
    // In the promoted render, the beam must stay above D3, F3 and E3 (the last three heads).
    const pts = [...promoted.querySelectorAll('.vf-beam path')].flatMap((p) => pathPoints(p));
    expect(pts.length).toBeGreaterThan(0);
    const beamTop = Math.max(...pts.map(([, y]) => y));
    for (const [, y] of heads(promoted).slice(1)) expect(beamTop).toBeLessThan(y);
  });

  it('the newest growing out of a pair leaves the other eighth pointing as it was drawn', () => {
    // C5 alone stems down. C5 + C4 beam as a pair with C5 stemmed UP (the pair's vote).
    // When C4 grows to a quarter it leaves the beam; C5 used to snap back DOWN.
    const c5 = { midis: [72], duration: '8' };
    const lone = render([c5]);
    expect(stemSide(lone.querySelector('g.vf-stavenote'))).toBe('down');
    const pair = render([c5, { midis: [60], duration: '8' }]);
    expect(beams(pair)).toBe(1);
    expect(beamSide(pair)).toBe('above');
    const grown = render([c5, { midis: [60], duration: 'q' }]);
    expect(beams(grown)).toBe(0);
    expect(stemSide(grown.querySelector('g.vf-stavenote'))).toBe('up');
    // ...and still after C4 closes as a quarter and another note arrives.
    const later = render([c5, { midis: [60], duration: 'q', widthDuration: 'q' }, { midis: [76], duration: '8' }]);
    expect(stemSide(later.querySelector('g.vf-stavenote'))).toBe('up');
  });

  it('tags every drawn note and beam with its staff (the sweep reads these)', () => {
    const host = render([{ midis: [48, 72], duration: '8' }, { midis: [50, 74], duration: '8' }]);
    expect(host.querySelectorAll('g.vf-stavenote[data-staff=treble]').length).toBe(2);
    expect(host.querySelectorAll('g.vf-stavenote[data-staff=bass]').length).toBe(2);
    expect(host.querySelectorAll('g.vf-beam[data-staff]').length).toBe(2);
  });

  it('lays accidentals out for the stem direction the beam gives the chord', () => {
    // G5 A5 decide DOWN; the G4-A♭4-C5 chord on its own stems up, with the A♭'s head
    // displaced to the right. Flipped after formatting, the A♭ moved to the LEFT of the
    // stem and drew on top of the flat, which had been placed for the up-stem layout.
    // (The review's case, E♭4-F4-G4, now leaves the group instead: stemmed down from
    // E♭4 its beam would reach into the bass staff.)
    const host = render([
      { midis: [79], duration: '8' },
      { midis: [81], duration: '8' },
      { midis: [67, 68, 72], duration: '8' },
    ]);
    expect(beamSide(host)).toBe('below');
    const chord = [...host.querySelectorAll('g.vf-stavenote')][2];
    const groups = [...chord.querySelectorAll('g.vf-notehead')];
    const bounds = (pts) => ({
      x0: Math.min(...pts.map(([x]) => x)), x1: Math.max(...pts.map(([x]) => x)),
      y0: Math.min(...pts.map(([, y]) => y)), y1: Math.max(...pts.map(([, y]) => y)),
    });
    const heads = groups.map((g) => bounds(pathPoints(g.querySelector(':scope > path'))));
    const accidentals = groups.flatMap((g) => [...g.querySelectorAll(':scope > path')].slice(1))
      .map((p) => bounds(pathPoints(p)));
    expect(heads).toHaveLength(3);
    expect(accidentals).toHaveLength(1);
    const [flat] = accidentals;
    for (const h of heads) {
      const yOverlap = flat.y0 < h.y1 && h.y0 < flat.y1;
      const xOverlap = flat.x0 < h.x1 && h.x0 < flat.x1;
      expect(yOverlap && xOverlap).toBe(false);
    }
  });

  it('leaves a ledger note out of a group that would throw its stem off the staff', () => {
    // Middle C (below the treble staff, stem up on its own) inside a high group that
    // stems down: flipping it would hang its stem — and the beam — below the staff, so
    // it keeps its own flag and splits the group around it. (All five placed in one
    // beat group — unitStart 0 — so only the ledger note can split them.)
    expect(beams(render([76, 79, 60, 77, 81].map((m) => ({ midis: [m], duration: '8', unitStart: 0 }))))).toBe(2);
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

describe('renderChordStaff — duration-weighted layout', () => {
  const STUDIO = 2.8;
  const render = (columns, aspect = STUDIO, keySignature = 'C') => {
    const host = document.createElement('div');
    renderChordStaff(host, { columns, keySignature, aspect });
    return host;
  };
  const pts = (p) => {
    const nums = (p.getAttribute('d') ?? '').match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    const out = [];
    for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
    return out;
  };
  // Leftmost x of each drawn column's first notehead, in draw order (treble voice first).
  const headXs = (host) => [...host.querySelectorAll('g.vf-stavenote')]
    .map((g) => Math.round(pts(g.querySelector('.vf-notehead > path'))[0][0] * 100) / 100);
  // Ink x-range of one stavenote group: every notehead and accidental outline in it.
  const inkX = (g) => {
    const xs = [...g.querySelectorAll('.vf-notehead > path')].flatMap((p) => pts(p).map(([x]) => x));
    return [Math.min(...xs), Math.max(...xs)];
  };
  const run = (n, duration, base = 60) =>
    Array.from({ length: n }, (_, i) => ({ midis: [base + [0, 2, 4, 5, 7, 9, 11, 12][i % 8]], duration }));

  it('keeps every earlier column where it was while the newest grows 8 → q → h', () => {
    // The newest column's duration is provisional and grows on the clock. Its width
    // grows with it — but nothing is to its right, so nothing on screen may move.
    const before = run(4, '8');
    const at = (d) => headXs(render([...before, { midis: [72], duration: d, widthDuration: d }]));
    const [e, q, h] = ['8', 'q', 'h'].map(at);
    expect(q.slice(0, 5)).toEqual(e.slice(0, 5));
    expect(h.slice(0, 5)).toEqual(e.slice(0, 5));
  });

  it('a hold promotion redraws the glyph but keeps the width the column closed with', () => {
    // Closed as an eighth, promoted to a half while held: the column to its right stays put.
    const closedAsEighth = [{ midis: [60], duration: '8' }, { midis: [64], duration: '8' }];
    const promoted = [{ midis: [60], duration: 'h', widthDuration: '8' }, { midis: [64], duration: '8' }];
    expect(headXs(render(promoted))).toEqual(headXs(render(closedAsEighth)));
  });

  it('spaces a quarter wider than an eighth, and a half wider than a quarter', () => {
    const gap = (d) => {
      const xs = headXs(render([{ midis: [60], duration: d }, { midis: [64], duration: 'q' }]));
      return xs[1] - xs[0];
    };
    expect(gap('q')).toBeGreaterThan(gap('8'));
    expect(gap('h')).toBeGreaterThan(gap('q'));
  });

  it('shows more columns of an all-eighth run than of an all-quarter line at the Studio aspect', () => {
    const drawn = (d) => render(run(16, d)).querySelectorAll('g.vf-stavenote').length;
    const eighths = drawn('8');
    const quarters = drawn('q');
    expect(eighths).toBeGreaterThan(quarters);
    expect(eighths).toBeGreaterThanOrEqual(11);
    expect(quarters).toBeGreaterThanOrEqual(8);
    // The NEWEST are the ones kept: the last column drawn is the last column given.
    const host = render(run(16, '8'));
    expect(chordStaffWindow(run(16, '8'), { aspect: STUDIO }).count).toBe(eighths);
    expect(host.querySelectorAll('g.vf-stavenote').length).toBe(eighths);
  });

  it('never lets a wide accidental-heavy chord collide with the eighth before it', () => {
    // An eighth's width is less than a quarter's; a chord full of accidentals (and a roll
    // stroke) next to it needs more than that. The ink floor must win.
    const chord = [61, 63, 66, 68, 70];
    const host = render([
      { midis: [60], duration: '8' },
      { midis: chord, duration: '8', arrivals: chord.map((midi, k) => ({ midi, at: k * 40 })) },
      { midis: [62], duration: '8' },
      { midis: [61, 63, 66], duration: '8' },
    ], STUDIO, 'C');
    const groups = [...host.querySelectorAll('g.vf-stavenote')];
    expect(groups).toHaveLength(4);
    const ranges = groups.map(inkX);
    for (let i = 1; i < ranges.length; i += 1) {
      expect(ranges[i][0]).toBeGreaterThan(ranges[i - 1][1]);
    }
  });

  it('scrolls: when the newest grows past the room, the OLDEST drops off', () => {
    const line = run(16, '8');
    const n = chordStaffWindow(line, { aspect: STUDIO }).count;
    const grown = [...line.slice(0, -1), { ...line[15], duration: 'h', widthDuration: 'h' }];
    const m = chordStaffWindow(grown, { aspect: STUDIO }).count;
    expect(m).toBeLessThanOrEqual(n);
    expect(m).toBeGreaterThanOrEqual(1);
  });

  it('always shows at least one column, however wide', () => {
    const cluster = Array.from({ length: 12 }, (_, i) => 60 + i);
    expect(chordStaffWindow([{ midis: cluster, duration: 'h' }], { aspect: 0.6 }).count).toBe(1);
  });

  it('leaves the single-chord form alone (one column, auto-stem lead)', () => {
    const host = document.createElement('div');
    renderChordStaff(host, { notes: new Map([[60, {}], [62, {}], [64, {}]]), keySignature: 'F#', aspect: 1.7 });
    expect(host.querySelectorAll('g.vf-stavenote').length).toBe(1);
  });
});

describe('renderChordStaff — one letter, one staff position', () => {
  const pts = (p) => {
    const nums = (p.getAttribute('d') ?? '').match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    const out = [];
    for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
    return out;
  };
  const box = (p) => {
    const q = pts(p);
    return {
      x0: Math.min(...q.map(([x]) => x)), x1: Math.max(...q.map(([x]) => x)),
      y0: Math.min(...q.map(([, y]) => y)), y1: Math.max(...q.map(([, y]) => y)),
    };
  };

  it('respells A♯ as B♭ beside an A♮ in F♯ major, so no two heads share a line', () => {
    // The speller writes pitch class 10 as A♯ in F♯ (in key) and 9 as A — one line.
    const host = document.createElement('div');
    renderChordStaff(host, { columns: [{ midis: [69, 70, 73], duration: 'q' }], keySignature: 'F#', aspect: 2.8 });
    const groups = [...host.querySelectorAll('g.vf-notehead')];
    const heads = groups.map((g) => box(g.querySelector(':scope > path')));
    expect(heads).toHaveLength(3);
    // Distinct staff positions: head centres at distinct heights.
    const ys = heads.map((h) => Math.round((h.y0 + h.y1) / 2));
    expect(new Set(ys).size).toBe(3);
    // And no accidental runs through another head.
    const accidentals = groups.flatMap((g) => [...g.querySelectorAll(':scope > path')].slice(1)).map(box);
    expect(accidentals.length).toBeGreaterThan(0);
    for (const a of accidentals) {
      for (const h of heads) {
        expect(a.x0 < h.x1 && h.x0 < a.x1 && a.y0 < h.y1 && h.y0 < a.y1).toBe(false);
      }
    }
  });
});

describe('renderChordStaff — light pulse: beat groups and breath bar lines', () => {
  const render = (columns, keySignature = 'C') => {
    const host = document.createElement('div');
    renderChordStaff(host, { columns, keySignature, aspect: 2.8 });
    return host;
  };
  const pts = (p) => {
    const nums = (p.getAttribute('d') ?? '').match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    const out = [];
    for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
    return out;
  };
  const headXs = (host) => [...host.querySelectorAll('g.vf-notehead')].map((g) => pts(g.querySelector(':scope > path'))[0][0]);
  // How many noteheads lie under each beam (by x), left to right.
  const beamSizes = (host) => {
    const xs = headXs(host);
    return [...host.querySelectorAll('.vf-beam path')].map((p) => {
      const q = pts(p).map(([x]) => x);
      const [x0, x1] = [Math.min(...q), Math.max(...q)];
      return xs.filter((x) => x >= x0 - 14 && x <= x1 + 1).length;
    }).sort((a, b) => a - b);
  };
  const melody = [60, 62, 64, 65, 67, 65, 64, 62, 60, 62, 64, 65, 67];
  const eighths = (ms, units) => ms.map((m, i) => ({ midis: [m], duration: '8', ...(units ? { unitStart: units[i] } : {}) }));

  it('beams a long run of eighths in fours, never across a two-beat boundary', () => {
    expect(beamSizes(render(eighths(melody.slice(0, 12))))).toEqual([4, 4, 4]);
  });

  it('keeps the grouping when the oldest scrolls off (the count is the column\'s own)', () => {
    // The model's unitStart travels with each column: with the first scrolled off, the
    // rest still group [1-3] [4-7] [8-11] [12], not in fours from the new left edge.
    const units = melody.map((_, i) => i);
    expect(beamSizes(render(eighths(melody.slice(1), units.slice(1))))).toEqual([3, 4, 4]);
  });

  it('draws a breath bar line only before a breath column, and restarts the count there', () => {
    const cols = [
      ...eighths([60, 62, 64]),
      { midis: [65], duration: 'h', widthDuration: 'h' },
      ...eighths([67, 65, 64, 62]).map((c, i) => ({ ...c, breathBefore: i === 0 })),
    ];
    const host = render(cols);
    expect(host.querySelectorAll('g.vf-breath-bar')).toHaveLength(1);
    // Count restarts at the bar: the four eighths after it beam as one group of four.
    expect(beamSizes(host)).toEqual([3, 4]);
    expect(render(cols.map((c) => ({ ...c, breathBefore: false }))).querySelectorAll('g.vf-breath-bar')).toHaveLength(0);
  });

  it('turns a beat group the other way when its vote would push out one of its two voters', () => {
    // F5 then F4 averages above the middle line → down, but F4 can't stem down without
    // reaching the bass staff, so it fell out and left F5 a lone flag. Up keeps all four.
    expect(beamSizes(render(eighths([77, 65, 72, 71])))).toEqual([4]);
  });

  it('draws no bar line before the first column on screen', () => {
    const host = render(eighths([60, 62]).map((c, i) => ({ ...c, breathBefore: i === 0 })));
    expect(host.querySelectorAll('g.vf-breath-bar')).toHaveLength(0);
  });

  it("keeps the bar line clear of the next column's accidentals and roll stroke", () => {
    const chord = [61, 63, 66, 68, 70];
    const host = render([
      { midis: [60], duration: 'h', widthDuration: 'h' },
      { midis: chord, duration: '8', breathBefore: true, arrivals: chord.map((midi, k) => ({ midi, at: k * 40 })) },
    ]);
    const bar = pts(host.querySelector('g.vf-breath-bar path, g.vf-breath-bar rect') ?? host.querySelector('g.vf-breath-bar *'));
    const barX = bar.length ? Math.max(...bar.map(([x]) => x)) : Number(host.querySelector('g.vf-breath-bar rect').getAttribute('x'));
    const [first, second] = [...host.querySelectorAll('g.vf-stavenote')];
    const inkXs = (g) => [...g.querySelectorAll('path')].flatMap((p) => pts(p).map(([x]) => x));
    expect(barX).toBeGreaterThan(Math.max(...inkXs(first)) + 2);
    expect(barX).toBeLessThan(Math.min(...inkXs(second)) - 2);
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

// The stroke comes from the ARRIVALS the flow recorded, judged per staff: each hand
// rolls (or strikes) on its own, so the treble and bass of one column can roll in
// opposite directions, or one roll while the other strikes.
describe('renderChordStaff — roll stroke from arrivals', () => {
  const arr = (...pairs) => pairs.map(([midi, at]) => ({ midi, at }));
  // Paths per stavenote group, treble groups first (the treble voice draws first).
  const staffPaths = (midis, arrivals) => {
    const host = document.createElement('div');
    renderChordStaff(host, { columns: [{ midis, arrivals }], keySignature: 'C', aspect: 2.8 });
    return [...host.querySelectorAll('g.vf-stavenote')].map((g) => g.querySelectorAll('path').length);
  };
  const total = (midis, arrivals) => staffPaths(midis, arrivals).reduce((a, b) => a + b, 0);

  it('draws a stroke for a staff whose arrivals span ROLL_MARK_MS', () => {
    const struck = total([60, 64, 67, 72], arr([60, 0], [64, 0], [67, 0], [72, 0]));
    expect(total([60, 64, 67, 72], arr([60, 0], [64, 40], [67, 70], [72, 100]))).toBeGreaterThan(struck);
    expect(total([60, 64, 67, 72], arr([72, 0], [67, 40], [64, 70], [60, 100]))).toBeGreaterThan(struck);
  });

  it('no stroke under ROLL_MARK_MS, nor without arrivals', () => {
    const struck = total([60, 64, 67, 72], arr([60, 0], [64, 0], [67, 0], [72, 0]));
    expect(total([60, 64, 67, 72], arr([60, 0], [64, 40], [67, 70], [72, 99]))).toBe(struck);
    expect(total([60, 64, 67, 72], undefined)).toBe(struck);
  });

  // Which stroke each staff drew: spy on Stroke.draw (calling through) and read the
  // stroke's type and its note's clef. Path counts can't tell the two types apart —
  // ROLL_UP and the directionless line span different heights, so their wiggle counts
  // differ as well as the arrowhead.
  const strokes = (midis, arrivals) => {
    const seen = {};
    const spy = vi.spyOn(Stroke.prototype, 'draw').mockImplementation(function draw() {
      seen[this.getNote().clef] = this.type === Stroke.Type.ROLL_UP ? 'down'
        : this.type === Stroke.Type.ARPEGGIO_DIRECTIONLESS ? 'up' : String(this.type);
    });
    try {
      renderChordStaff(document.createElement('div'), { columns: [{ midis, arrivals }], keySignature: 'C', aspect: 2.8 });
    } finally { spy.mockRestore(); }
    return seen;
  };

  it('judges each staff on its own arrivals: RH top-down rolls down, LH bottom-up rolls up', () => {
    const midis = [48, 52, 55, 72, 76, 79];
    // RH 79→76→72 (down), LH 48→52→55 (up), interleaved over 150ms.
    expect(strokes(midis, arr([79, 0], [48, 10], [76, 60], [52, 70], [72, 120], [55, 150])))
      .toEqual({ treble: 'down', bass: 'up' });
    expect(strokes(midis, arr([72, 0], [55, 10], [76, 60], [52, 70], [79, 120], [48, 150])))
      .toEqual({ treble: 'up', bass: 'down' });
    expect(strokes(midis, arr(...midis.map((m) => [m, 0])))).toEqual({});
  });

  it('ROLL_MARK_MS is per staff: a struck bass under a rolled treble gets no stroke', () => {
    const midis = [48, 52, 55, 72, 76, 79];
    // The column spans 140ms, but the bass's three keys land within 30ms of each other.
    expect(strokes(midis, arr([48, 0], [52, 10], [55, 30], [72, 40], [76, 80], [79, 140])))
      .toEqual({ treble: 'up' });
    // Treble 99ms: just under the mark.
    expect(strokes(midis, arr([48, 0], [52, 60], [55, 120], [72, 0], [76, 50], [79, 99])))
      .toEqual({ bass: 'up' });
  });

  it('draws no stroke on a staff that holds one note', () => {
    const struck = (midis) => total(midis, arr(...midis.map((m) => [m, 0])));
    expect(total([67], arr([67, 0]))).toBe(struck([67]));
    // Lone bass note under a rolled RH chord: only the treble chord is stroked.
    const chordGain = total([72, 76, 79], arr([72, 0], [76, 60], [79, 120])) - struck([72, 76, 79]);
    expect(chordGain).toBeGreaterThan(0);
    expect(total([48, 72, 76, 79], arr([48, 0], [72, 10], [76, 60], [79, 200])) - struck([48, 72, 76, 79])).toBe(chordGain);
  });
});

// Modifiers are laid out from the TickContext x, not the note's x_shift (VexFlow 4.2.5:
// Accidental.draw reads note.getModifierStartXY(), which is getAbsoluteX() — the tick
// context — while noteheads draw at getNoteHeadBeginX() = getAbsoluteX() + x_shift).
// So the slot snap has to move the tick context, or accidentals stay where the
// formatter put them while the noteheads walk away from them.
describe('renderChordStaff — modifiers move with their notes', () => {
  const firstX = (path) => Number(/^M\s*([-\d.]+)/.exec(path.getAttribute('d'))[1]);

  it('every accidental sits LEFT of its notehead across a full flow', () => {
    const host = document.createElement('div');
    renderChordStaff(host, {
      columns: [
        { midis: [61], duration: '8' }, { midis: [63, 66], duration: 'h' }, { midis: [70] },
        { midis: [49, 61, 66], duration: '8' }, { midis: [68], duration: 'h' }, { midis: [73, 78] },
        { midis: [42, 54], duration: '8' },
      ],
      keySignature: 'C',
      aspect: 2.8,
    });
    const heads = [...host.querySelectorAll('g.vf-notehead')]
      .map((g) => [...g.querySelectorAll(':scope > path')])
      .filter((paths) => paths.length > 1);
    expect(heads.length).toBeGreaterThan(5);
    for (const [head, accidental] of heads) expect(firstX(accidental)).toBeLessThan(firstX(head));
  });

  it("the first column's accidentals and stroke clear the key signature", () => {
    // A lone in-key note's head sits NOTE_INSET (10) + the stave's note padding (12)
    // past the key signature: that gives the key signature's right edge.
    const plain = document.createElement('div');
    renderChordStaff(plain, { columns: [{ midis: [66] }], keySignature: 'F#', aspect: 2.8 });
    const keyEdge = firstX(plain.querySelector('g.vf-notehead > path')) - 22;
    // A rolled cluster full of naturals in F# major: accidental columns + a stroke.
    const midis = [60, 62, 64, 65, 67, 69];
    const host = document.createElement('div');
    renderChordStaff(host, {
      columns: [{ midis, arrivals: midis.map((midi, k) => ({ midi, at: k * 40 })) }, { midis: [72] }],
      keySignature: 'F#',
      aspect: 2.8,
    });
    const first = host.querySelector('g.vf-stavenote');
    const inkLeft = Math.min(...[...first.querySelectorAll('g.vf-notehead path')].map(firstX));
    expect(inkLeft).toBeGreaterThanOrEqual(keyEdge);
    // ...and not much more: the line starts only as late as it must. In a flow the lead
    // reserves the column's left reach in EITHER stem direction (a beam can flip it),
    // so a chord with seconds may sit up to one displaced notehead (~12) later — two
    // here, since this cluster in F♯ spells one letter both ways (E and E♯ share a
    // line), and that hidden second head is booked on both sides too.
    expect(inkLeft).toBeLessThanOrEqual(keyEdge + 6 + 24);
  });
});
