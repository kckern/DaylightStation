import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SvgSequenceStaff } from './SvgSequenceStaff.jsx';

// jsdom sees SVG STRUCTURE, never layout: element counts, classes, and the
// `data-` attributes the component publishes so vertical truth is assertable
// without a layout engine. Real geometry is measured in Chromium by a later
// task; nothing here may pretend to check pixels.

const notes = (...midis) => midis.map((midi) => ({ midi }));
const lineOffsets = (container, selector) =>
  [...container.querySelectorAll(selector)].map((el) => Number(el.getAttribute('data-line-offset')));

describe('SvgSequenceStaff', () => {
  // ── One staff, always ──────────────────────────────────────────────────────
  describe('one staff, always', () => {
    it('renders exactly one staff group of five lines', () => {
      const { container } = render(<SvgSequenceStaff notes={notes(60, 62, 64, 65, 67)} />);
      expect(container.querySelectorAll('.action-staff__staff')).toHaveLength(1);
      expect(container.querySelectorAll('.action-staff__staff-area')).toHaveLength(1);
      expect(container.querySelectorAll('.action-staff__staff line')).toHaveLength(5);
    });

    it('never grows a second staff for a sequence that spans both clefs', () => {
      // C2 up to C6 — a grand-staff span. One staff still, with ledger lines.
      const { container } = render(<SvgSequenceStaff notes={notes(36, 48, 60, 72, 84)} />);
      expect(container.querySelectorAll('.action-staff__staff')).toHaveLength(1);
    });

    it('handles an empty sequence without throwing', () => {
      const { container } = render(<SvgSequenceStaff notes={[]} />);
      expect(container.querySelectorAll('.action-staff__staff')).toHaveLength(1);
      expect(container.querySelectorAll('.action-staff__note')).toHaveLength(0);
    });
  });

  // ── Clef: chosen, never defaulted (engraving rule 1) ───────────────────────
  describe('clef', () => {
    it('draws exactly one clef glyph', () => {
      const { container } = render(<SvgSequenceStaff notes={notes(60, 62, 64)} />);
      expect(container.querySelectorAll('.action-staff__notation-svg text')).toHaveLength(1);
    });

    it('is treble for an all-C4-and-above sequence', () => {
      const { container } = render(<SvgSequenceStaff notes={notes(60, 62, 64, 65, 67, 69, 71, 72)} />);
      expect(container.querySelector('[data-clef]').getAttribute('data-clef')).toBe('treble');
      expect(container.querySelector('.action-staff__notation-svg text').textContent).toBe('\u{1D11E}');
    });

    it('is bass for an all-below-C3 sequence', () => {
      const { container } = render(<SvgSequenceStaff notes={notes(36, 38, 40, 41, 43)} />);
      expect(container.querySelector('[data-clef]').getAttribute('data-clef')).toBe('bass');
      expect(container.querySelector('.action-staff__notation-svg text').textContent).toBe('\u{1D122}');
    });

    it('follows the MAJORITY pitch, not the first one', () => {
      // First note is deep bass; the other four are treble. Deriving from the
      // first pitch (SvgStaffRenderer's rule) would put a treble scale on a
      // bass clef — the bug this component exists to stop.
      const { container } = render(<SvgSequenceStaff notes={notes(36, 60, 62, 64, 65)} />);
      expect(container.querySelector('[data-clef]').getAttribute('data-clef')).toBe('treble');
    });

    it('an explicit clef prop wins over the derived one', () => {
      const { container } = render(<SvgSequenceStaff notes={notes(60, 62, 64)} clef="bass" />);
      expect(container.querySelector('[data-clef]').getAttribute('data-clef')).toBe('bass');
      expect(container.querySelector('.action-staff__notation-svg text').textContent).toBe('\u{1D122}');
    });

    it('positions notes against the CHOSEN clef, not each pitch\'s own', () => {
      // Middle C sits two steps BELOW the treble staff and ten steps ABOVE the
      // bass staff's bottom line — a 12-step difference. Reading the position
      // straight off getStaffPosition would give the same number for both.
      const treble = render(<SvgSequenceStaff notes={notes(60)} clef="treble" />);
      const bass = render(<SvgSequenceStaff notes={notes(60)} clef="bass" />);
      expect(lineOffsets(treble.container, '.action-staff__note')).toEqual([-2]);
      expect(lineOffsets(bass.container, '.action-staff__note')).toEqual([10]);
    });
  });

  // ── Ordered noteheads ──────────────────────────────────────────────────────
  describe('ordered noteheads', () => {
    it('renders one notehead per input note', () => {
      const { container } = render(<SvgSequenceStaff notes={notes(60, 62, 64, 65, 67, 69, 71, 72)} />);
      expect(container.querySelectorAll('.action-staff__note')).toHaveLength(8);
      expect(container.querySelectorAll('[data-sequence-index]')).toHaveLength(8);
    });

    it('renders a simultaneous ask as ONE entry with a notehead per pitch', () => {
      const { container } = render(<SvgSequenceStaff notes={[{ midis: [60, 64, 67] }, { midi: 72 }]} />);
      expect(container.querySelectorAll('[data-sequence-index]')).toHaveLength(2);
      expect(container.querySelectorAll('.action-staff__note')).toHaveLength(4);
      const chord = container.querySelector('[data-sequence-index="0"]');
      expect(chord.querySelectorAll('.action-staff__note')).toHaveLength(3);
    });

    it('lays entries out left to right in order', () => {
      const { container } = render(<SvgSequenceStaff notes={notes(60, 62, 64, 65)} />);
      const xs = [...container.querySelectorAll('.action-staff__note')].map((n) => Number(n.getAttribute('cx')));
      expect(xs).toEqual([...xs].sort((a, b) => a - b));
      expect(new Set(xs).size).toBe(4); // even columns, never stacked
    });

    it('a rising sequence climbs the staff', () => {
      const { container } = render(<SvgSequenceStaff notes={notes(60, 62, 64, 65, 67)} />);
      expect(lineOffsets(container, '.action-staff__note')).toEqual([-2, -1, 0, 1, 2]);
    });
  });

  // ── Cursor state classes ───────────────────────────────────────────────────
  describe('cursor', () => {
    it('classes every notehead done / next / todo around cursorIndex', () => {
      const { container } = render(<SvgSequenceStaff notes={notes(60, 62, 64, 65)} cursorIndex={2} />);
      expect(container.querySelectorAll('.sequence-note-done')).toHaveLength(2);
      expect(container.querySelectorAll('.sequence-note-next')).toHaveLength(1);
      expect(container.querySelectorAll('.sequence-note-todo')).toHaveLength(1);
      expect(container.querySelector('.sequence-note-next').getAttribute('data-midi')).toBe('64');
    });

    it('marks nothing done at the start of a run', () => {
      const { container } = render(<SvgSequenceStaff notes={notes(60, 62, 64)} cursorIndex={0} />);
      expect(container.querySelectorAll('.sequence-note-done')).toHaveLength(0);
      expect(container.querySelectorAll('.sequence-note-next')).toHaveLength(1);
      expect(container.querySelectorAll('.sequence-note-todo')).toHaveLength(2);
    });

    it('marks everything done and nothing next once the sequence is complete', () => {
      const { container } = render(<SvgSequenceStaff notes={notes(60, 62, 64)} cursorIndex={3} />);
      expect(container.querySelectorAll('.sequence-note-done')).toHaveLength(3);
      expect(container.querySelectorAll('.sequence-note-next')).toHaveLength(0);
      expect(container.querySelectorAll('.sequence-note-todo')).toHaveLength(0);
    });

    it('classes every notehead of a simultaneous entry alike', () => {
      const { container } = render(
        <SvgSequenceStaff notes={[{ midis: [60, 64, 67] }, { midi: 72 }]} cursorIndex={0} />
      );
      expect(container.querySelectorAll('.sequence-note-next')).toHaveLength(3);
      expect(container.querySelectorAll('.sequence-note-todo')).toHaveLength(1);
    });

    it('marks the cursor column itself so the child can see where they are', () => {
      const { container } = render(<SvgSequenceStaff notes={notes(60, 62, 64)} cursorIndex={1} />);
      const cursor = container.querySelectorAll('.sequence-staff__cursor');
      expect(cursor).toHaveLength(1);
      // Deliberately NOT `data-sequence-index`: that attribute counts entries,
      // and a cursor wearing it would inflate every entry count in this file.
      expect(cursor[0].getAttribute('data-cursor-index')).toBe('1');
    });

    it('drops the cursor marker once the sequence is finished', () => {
      const { container } = render(<SvgSequenceStaff notes={notes(60, 62, 64)} cursorIndex={3} />);
      expect(container.querySelectorAll('.sequence-staff__cursor')).toHaveLength(0);
    });
  });

  // ── The wrong note, shown where it actually is ─────────────────────────────
  describe('wrong-note ghost', () => {
    it('adds exactly one ghost notehead without disturbing the targets', () => {
      const { container } = render(
        <SvgSequenceStaff notes={notes(60, 62, 64)} cursorIndex={1} wrongMidi={65} />
      );
      expect(container.querySelectorAll('.action-staff__note')).toHaveLength(3);
      expect(container.querySelectorAll('.sequence-note-wrong-ghost')).toHaveLength(1);
    });

    it('renders no ghost when nothing wrong was played', () => {
      const { container } = render(<SvgSequenceStaff notes={notes(60, 62, 64)} cursorIndex={1} />);
      expect(container.querySelectorAll('.sequence-note-wrong-ghost')).toHaveLength(0);
    });

    it('sits at its OWN staff position, not the target\'s', () => {
      // Target at the cursor is D4 (62); the child played F4 (65). The ghost
      // must sit where an F4 belongs, which is a different line offset.
      const { container } = render(
        <SvgSequenceStaff notes={notes(60, 62, 64)} cursorIndex={1} wrongMidi={65} />
      );
      const [ghost] = lineOffsets(container, '.sequence-note-wrong-ghost');
      const target = Number(
        container.querySelector('.sequence-note-next').getAttribute('data-line-offset')
      );
      expect(ghost).toBe(1); // F4 on treble
      expect(target).toBe(-1); // D4 on treble
      expect(ghost).not.toBe(target);
    });

    it('reads the wrong note on the CHOSEN clef too', () => {
      const { container } = render(
        <SvgSequenceStaff notes={notes(60, 62)} clef="bass" cursorIndex={0} wrongMidi={65} />
      );
      expect(lineOffsets(container, '.sequence-note-wrong-ghost')).toEqual([13]); // F4 on bass
    });

    it('stands near the cursor column so the child can compare', () => {
      const { container } = render(
        <SvgSequenceStaff notes={notes(60, 62, 64, 65)} cursorIndex={2} wrongMidi={61} />
      );
      const ghostX = Number(container.querySelector('.sequence-note-wrong-ghost').getAttribute('cx'));
      const cursorX = Number(container.querySelector('.sequence-note-next').getAttribute('cx'));
      const nextColX = Number(
        container.querySelector('[data-sequence-index="3"] .action-staff__note').getAttribute('cx')
      );
      expect(ghostX).toBeGreaterThan(cursorX);
      expect(ghostX).toBeLessThan(nextColX);
    });

    it('draws the accidental of a wrong black key', () => {
      const { container } = render(
        <SvgSequenceStaff notes={notes(60, 62)} cursorIndex={0} wrongMidi={61} />
      );
      const acc = container.querySelector('.sequence-staff__ghost-accidental');
      expect(acc).toBeTruthy();
      expect(acc.querySelector('text')).toBeNull();
      expect(acc.querySelectorAll('path, line').length).toBeGreaterThan(0);
    });
  });

  // ── Held keys ──────────────────────────────────────────────────────────────
  describe('held-key ghosts', () => {
    it('ghosts a held non-target key at 50%', () => {
      const active = new Map([[69, { velocity: 80 }]]); // A4, not in the sequence
      const { container } = render(
        <SvgSequenceStaff notes={notes(60, 62, 64)} cursorIndex={0} activeNotes={active} />
      );
      const held = container.querySelectorAll('.sequence-staff__held-ghost');
      expect(held).toHaveLength(1);
      expect(held[0].getAttribute('opacity')).toBe('0.5');
      expect(held[0].getAttribute('data-midi')).toBe('69');
    });

    it('never ghosts a key that is one of the targets', () => {
      const active = new Map([[60, { velocity: 80 }], [62, { velocity: 80 }]]);
      const { container } = render(
        <SvgSequenceStaff notes={notes(60, 62, 64)} cursorIndex={0} activeNotes={active} />
      );
      expect(container.querySelectorAll('.sequence-staff__held-ghost')).toHaveLength(0);
    });

    it('never double-draws the wrong note as a held ghost as well', () => {
      const active = new Map([[65, { velocity: 80 }]]);
      const { container } = render(
        <SvgSequenceStaff notes={notes(60, 62, 64)} cursorIndex={1} wrongMidi={65} activeNotes={active} />
      );
      expect(container.querySelectorAll('.sequence-note-wrong-ghost')).toHaveLength(1);
      expect(container.querySelectorAll('.sequence-staff__held-ghost')).toHaveLength(0);
    });
  });

  // ── Accidentals and ledger lines ───────────────────────────────────────────
  describe('accidentals and ledger lines', () => {
    it('draws a black key\'s accidental as shapes, never as a font glyph', () => {
      const { container } = render(<SvgSequenceStaff notes={notes(61, 63)} />);
      const accs = container.querySelectorAll('.action-staff__accidental');
      expect(accs).toHaveLength(2);
      for (const acc of accs) {
        expect(acc.querySelector('text')).toBeNull();
        expect(acc.querySelectorAll('path, line').length).toBeGreaterThan(0);
      }
      // The only <text> in the notation svg stays the clef.
      expect(container.querySelectorAll('.action-staff__notation-svg text')).toHaveLength(1);
    });

    it('spells a D-flat major scale with flats when asked to', () => {
      // Db Eb F Gb Ab Bb C Db — six black keys in the octave-and-tonic run
      // (five distinct flats, with the tonic Db drawn again on top).
      const dFlatScale = notes(61, 63, 65, 66, 68, 70, 72, 73);
      const { container } = render(<SvgSequenceStaff notes={dFlatScale} accidental="flat" />);
      const accs = [...container.querySelectorAll('.action-staff__accidental')];
      expect(accs).toHaveLength(6);
      expect(accs.every((a) => a.getAttribute('data-kind') === 'flat')).toBe(true);
      // Flat spelling steps by letter: Db Eb F Gb Ab Bb C Db never repeats a line.
      expect(lineOffsets(container, '.action-staff__note')).toEqual([-1, 0, 1, 2, 3, 4, 5, 6]);
    });

    it('honours a per-note accidental override', () => {
      const { container } = render(
        <SvgSequenceStaff notes={[{ midi: 61, accidental: 'flat' }, { midi: 63, accidental: 'sharp' }]} />
      );
      const kinds = [...container.querySelectorAll('.action-staff__accidental')].map((a) =>
        a.getAttribute('data-kind')
      );
      expect(kinds).toEqual(['flat', 'sharp']);
    });

    it('keeps the accidental clear of its own notehead', () => {
      const { container } = render(<SvgSequenceStaff notes={notes(61)} />);
      const acc = container.querySelector('.action-staff__accidental');
      const note = container.querySelector('.action-staff__note');
      const accX = Number(/translate\(([-\d.]+)/.exec(acc.getAttribute('transform'))[1]);
      const noteLeftEdge = Number(note.getAttribute('cx')) - Number(note.getAttribute('rx'));
      expect(accX).toBeLessThan(noteLeftEdge);
    });

    it('draws ledger lines for notes off the staff', () => {
      // Middle C below the treble staff (one ledger) and C6 above it (two).
      const { container } = render(<SvgSequenceStaff notes={notes(60, 64, 84)} />);
      expect(container.querySelectorAll('[data-sequence-index="0"] .action-staff__ledger')).toHaveLength(1);
      expect(container.querySelectorAll('[data-sequence-index="1"] .action-staff__ledger')).toHaveLength(0);
      expect(container.querySelectorAll('[data-sequence-index="2"] .action-staff__ledger')).toHaveLength(2);
    });
  });

  // ── Stems ──────────────────────────────────────────────────────────────────
  describe('stems', () => {
    it('gives every entry one stem, engraved by the shared rule', () => {
      const { container } = render(<SvgSequenceStaff notes={notes(64, 71)} />);
      const stems = container.querySelectorAll('.action-staff__stem');
      expect(stems).toHaveLength(2);
      // E4 sits below the middle line → up (stem right of the head); B4 is the
      // middle line → down (stem left of it), per model/stems.js.
      const heads = [...container.querySelectorAll('.action-staff__note')];
      expect(Number(stems[0].getAttribute('x1'))).toBeGreaterThan(Number(heads[0].getAttribute('cx')));
      expect(Number(stems[1].getAttribute('x1'))).toBeLessThan(Number(heads[1].getAttribute('cx')));
    });
  });

  // ── Readability at scale length ────────────────────────────────────────────
  describe('sizing', () => {
    it('widens the viewBox as the sequence grows so ten notes stay in even columns', () => {
      const short = render(<SvgSequenceStaff notes={notes(60, 62)} />);
      const long = render(<SvgSequenceStaff notes={notes(60, 62, 64, 65, 67, 69, 71, 72, 71, 69)} />);
      const width = (c) =>
        Number(c.querySelector('.action-staff__notation-svg').getAttribute('viewBox').split(' ')[2]);
      expect(width(long.container)).toBeGreaterThan(width(short.container));
      // Both SVGs must share one coordinate system or the lines and the notes
      // disagree (the STAFF_ASPECT lesson from SvgStaffRenderer).
      expect(long.container.querySelector('.action-staff__lines-svg').getAttribute('viewBox')).toBe(
        long.container.querySelector('.action-staff__notation-svg').getAttribute('viewBox')
      );
      const columns = [...long.container.querySelectorAll('.action-staff__note')].map((n) =>
        Number(n.getAttribute('cx'))
      );
      const gaps = columns.slice(1).map((x, i) => x - columns[i]);
      expect(new Set(gaps).size).toBe(1); // even columns
    });
  });
});
