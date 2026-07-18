import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PendingLayer } from './PendingLayer.jsx';

// One system, chosen so the position math lands on round numbers:
//   top = 100 is the TOP staff line; 5 lines / 4 gaps of 10 → bottom line at 140.
//   A staff half-step is lineSpacing/2 = 5px.
const STAVE = { system: 0, top: 100, left: 50, right: 500, lineSpacing: 10 };
const BOTTOM_LINE_Y = 140; // independently computed: 100 + 10 * 4
const HALF = 5; // lineSpacing / 2

const TREBLE = { sign: 'G', line: 2 };
const BASS = { sign: 'F', line: 4 };

// y for a hand-computed staff position, derived here rather than read back from
// the component, so these assertions fail if the component's math drifts.
const yAt = (position) => BOTTOM_LINE_Y - position * HALF;

const note = (step, octave, opts = {}) => ({
  rest: false,
  pitch: { step, octave, alter: opts.alter ?? 0 },
  type: opts.type ?? 'quarter',
  dots: opts.dots ?? 0,
});

const draw = (props) =>
  render(<PendingLayer staves={[STAVE]} anchorX={200} anchorSystem={0} clef={TREBLE} {...props} />).container;

const heads = (c) => [...c.querySelectorAll('.composer-wet-note__head')];

describe('PendingLayer', () => {
  describe('nothing to paint', () => {
    it('renders nothing with empty pending', () => {
      expect(draw({ pending: [] }).querySelector('.composer-wet-note')).toBeNull();
    });

    it('renders nothing when the anchored system is missing from the geometry', () => {
      const c = render(
        <PendingLayer staves={[STAVE]} anchorSystem={3} anchorX={200} clef={TREBLE} pending={[note('E', 4)]} />
      ).container;
      expect(c.querySelector('.composer-wet-note')).toBeNull();
    });

    it('renders nothing when staves is empty', () => {
      const c = render(<PendingLayer staves={[]} anchorX={200} clef={TREBLE} pending={[note('E', 4)]} />).container;
      expect(c.querySelector('.composer-wet-note')).toBeNull();
    });
  });

  describe('staff position', () => {
    // E4 is the treble bottom line: position 0, so it sits exactly on bottomLineY.
    it('puts E4 on the treble bottom line, at anchorX', () => {
      const [head] = heads(draw({ pending: [note('E', 4)] }));
      expect(Number(head.getAttribute('cx'))).toBe(200);
      expect(Number(head.getAttribute('cy'))).toBe(yAt(0));
      expect(Number(head.getAttribute('cy'))).toBe(140); // spelled out: no indirection
    });

    it('puts F4 in the first treble space (position 1)', () => {
      const [head] = heads(draw({ pending: [note('F', 4)] }));
      expect(Number(head.getAttribute('cy'))).toBe(yAt(1)); // 135
    });

    it('puts C5 on the third treble space (position 5)', () => {
      const [head] = heads(draw({ pending: [note('C', 5)] }));
      expect(Number(head.getAttribute('cy'))).toBe(yAt(5)); // 115
    });

    // The regression guard for reading the clef off the pitch: middle C is a
    // ledger line BELOW a treble staff but sits inside a bass staff.
    it('places the same pitch differently on treble vs bass clef', () => {
      const [treble] = heads(draw({ clef: TREBLE, pending: [note('C', 4)] }));
      const [bass] = heads(draw({ clef: BASS, pending: [note('C', 4)] }));
      expect(Number(treble.getAttribute('cy'))).toBe(yAt(-2)); // 150, below the staff
      expect(Number(bass.getAttribute('cy'))).toBe(yAt(10)); // 90, inside the staff
      expect(treble.getAttribute('cy')).not.toBe(bass.getAttribute('cy'));
    });

    // The regression guard for NOT routing through MIDI: C#4 and Db4 are the same
    // MIDI number (61) but different staff lines. Going via MIDI would collapse them.
    it('separates C#4 and Db4 — same MIDI, different spelling, different line', () => {
      const [sharp] = heads(draw({ pending: [note('C', 4, { alter: 1 })] }));
      const [flat] = heads(draw({ pending: [note('D', 4, { alter: -1 })] }));
      expect(Number(sharp.getAttribute('cy'))).toBe(yAt(-2)); // 150
      expect(Number(flat.getAttribute('cy'))).toBe(yAt(-1)); // 145
      expect(sharp.getAttribute('cy')).not.toBe(flat.getAttribute('cy'));
    });
  });

  describe('ledger lines', () => {
    it('draws one ledger line for middle C (position -2)', () => {
      const c = draw({ pending: [note('C', 4)] });
      const ledgers = c.querySelectorAll('.composer-wet-note__ledger');
      expect(ledgers).toHaveLength(1);
      expect(Number(ledgers[0].getAttribute('y1'))).toBe(yAt(-2)); // 150
    });

    it('draws no ledger line for a note on the staff', () => {
      expect(draw({ pending: [note('E', 4)] }).querySelectorAll('.composer-wet-note__ledger')).toHaveLength(0);
    });

    // A3 is position -4 — it sits ON the second ledger line below the staff, so the
    // C4 line (-2) is needed underneath it as well.
    it('draws every ledger line down to a low note', () => {
      const c = draw({ pending: [note('A', 3)] });
      const ys = [...c.querySelectorAll('.composer-wet-note__ledger')].map((l) => Number(l.getAttribute('y1')));
      expect(ys.sort((a, b) => a - b)).toEqual([yAt(-2), yAt(-4)]); // 150, 160
    });

    // Ledgers go ABOVE the staff too: A5 is position 10, one line above top line F5 (8).
    it('draws a ledger line above the staff for A5', () => {
      const c = draw({ pending: [note('A', 5)] });
      const ledgers = c.querySelectorAll('.composer-wet-note__ledger');
      expect(ledgers).toHaveLength(1);
      expect(Number(ledgers[0].getAttribute('y1'))).toBe(yAt(10)); // 90
    });

    it('draws no ledger line for the top staff line F5 (position 8)', () => {
      expect(draw({ pending: [note('F', 5)] }).querySelectorAll('.composer-wet-note__ledger')).toHaveLength(0);
    });
  });

  describe('notehead and stem', () => {
    it('fills a quarter notehead and leaves a half hollow', () => {
      const [quarter] = heads(draw({ pending: [note('E', 4, { type: 'quarter' })] }));
      const [half] = heads(draw({ pending: [note('E', 4, { type: 'half' })] }));
      expect(quarter.getAttribute('fill')).not.toBe('none');
      expect(half.getAttribute('fill')).toBe('none');
    });

    it('leaves a whole note hollow and stemless', () => {
      const c = draw({ pending: [note('E', 4, { type: 'whole' })] });
      expect(heads(c)[0].getAttribute('fill')).toBe('none');
      expect(c.querySelectorAll('.composer-wet-note__stem')).toHaveLength(0);
    });

    it('stems every note that is not a whole note', () => {
      expect(draw({ pending: [note('E', 4, { type: 'quarter' })] }).querySelectorAll('.composer-wet-note__stem'))
        .toHaveLength(1);
    });

    // Below the middle line (position 4) the stem goes up on the right; at or above
    // it, down on the left — otherwise high notes run off the top of the system.
    it('stems up on the right below the middle line, down on the left above it', () => {
      const low = draw({ pending: [note('E', 4)] }).querySelector('.composer-wet-note__stem'); // position 0
      const high = draw({ pending: [note('C', 5)] }).querySelector('.composer-wet-note__stem'); // position 5

      expect(Number(low.getAttribute('x1'))).toBeGreaterThan(200); // right of the head
      expect(Number(low.getAttribute('y2'))).toBeLessThan(yAt(0)); // reaches upward

      expect(Number(high.getAttribute('x1'))).toBeLessThan(200); // left of the head
      expect(Number(high.getAttribute('y2'))).toBeGreaterThan(yAt(5)); // reaches downward
    });

    it('draws a dot to the right of a dotted note, and none otherwise', () => {
      const dotted = draw({ pending: [note('E', 4, { dots: 1 })] });
      const dots = dotted.querySelectorAll('.composer-wet-note__dot');
      expect(dots).toHaveLength(1);
      expect(Number(dots[0].getAttribute('cx'))).toBeGreaterThan(200);

      expect(draw({ pending: [note('E', 4)] }).querySelectorAll('.composer-wet-note__dot')).toHaveLength(0);
    });
  });

  describe('accidentals', () => {
    it('marks a sharp and a flat left of the notehead, and nothing for a natural', () => {
      const sharp = draw({ pending: [note('C', 4, { alter: 1 })] }).querySelector('.composer-wet-note__acc');
      const flat = draw({ pending: [note('D', 4, { alter: -1 })] }).querySelector('.composer-wet-note__acc');
      expect(sharp).toBeTruthy();
      expect(flat).toBeTruthy();
      expect(sharp.getAttribute('data-acc')).toBe('sharp');
      expect(flat.getAttribute('data-acc')).toBe('flat');
      expect(draw({ pending: [note('C', 4)] }).querySelector('.composer-wet-note__acc')).toBeNull();
    });

    // Standing house rule: Unicode music glyphs render as tofu on the kiosk, so
    // every glyph must be drawn SVG geometry.
    it('draws accidentals as SVG geometry, never as text', () => {
      const c = draw({ pending: [note('C', 4, { alter: 1 })] });
      expect(c.querySelector('.composer-wet-note text')).toBeNull();
      expect(c.querySelector('.composer-wet-note__acc line, .composer-wet-note__acc path')).toBeTruthy();
    });
  });

  describe('rests', () => {
    it('renders a rest mark instead of a notehead', () => {
      const c = draw({ pending: [{ rest: true, type: 'quarter', dots: 0 }] });
      expect(c.querySelectorAll('.composer-wet-note__rest')).toHaveLength(1);
      expect(heads(c)).toHaveLength(0);
      expect(c.querySelectorAll('.composer-wet-note__stem')).toHaveLength(0);
    });

    it('parks the rest around the middle of the staff', () => {
      const c = draw({ pending: [{ rest: true, type: 'quarter' }] });
      const rest = c.querySelector('.composer-wet-note__rest');
      const mid = Number(rest.getAttribute('y')) + Number(rest.getAttribute('height')) / 2;
      expect(mid).toBeCloseTo(yAt(4), 5); // 120 — the middle staff line
    });
  });

  describe('horizontal layout', () => {
    it('advances successive notes by a fixed step from anchorX', () => {
      const c = draw({ pending: [note('E', 4), note('F', 4), note('G', 4)] });
      const xs = heads(c).map((h) => Number(h.getAttribute('cx')));
      expect(xs).toHaveLength(3);
      expect(xs[0]).toBe(200);
      const advance = xs[1] - xs[0];
      expect(advance).toBeGreaterThan(0);
      expect(xs[2] - xs[1]).toBe(advance); // uniform
    });

    it('clamps notes so they never paint past the right edge of the system', () => {
      // Far more notes than fit between anchorX (200) and right (500).
      const pending = Array.from({ length: 40 }, () => note('E', 4));
      const xs = heads(draw({ pending })).map((h) => Number(h.getAttribute('cx')));
      expect(xs).toHaveLength(40);
      for (const x of xs) expect(x).toBeLessThanOrEqual(STAVE.right);
      // Once clamped, the overflow notes stack at the same x rather than marching off.
      expect(xs[39]).toBe(xs[38]);
    });
  });
});
