import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { SvgSequenceStaff, classifyHeldPitch } from './SvgSequenceStaff.jsx';

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

  // ── Resting palette: colour, never opacity (rule 1 + the brown amendment) ──
  // Opacity carries exactly one meaning on this staff — "this is your finger,
  // not the music" — so a NOTATED note is full opacity in every state, always.
  // Weight-behind/weight-ahead used to be encoded as green-done/dimmed-todo;
  // it is now jet-black-done vs. brown-todo. The cursor's OWN resting entry is
  // its own state, `current`, and it is BLACK, not brown (124db2188): it is the
  // note the child is reading right now, so only entries AFTER it are brown.
  // Black-vs-brown therefore reads as "read this far" — a resting cursor makes
  // no claim about whether the note was played, which is still rule 5's job.
  describe('resting palette (done / todo, no attempt in progress)', () => {
    it('colours entries before the cursor done, the cursor current, and the rest todo', () => {
      const { container } = render(<SvgSequenceStaff notes={notes(60, 62, 64, 65)} cursorIndex={2} />);
      expect(container.querySelectorAll('.sequence-note-done')).toHaveLength(2);
      expect(container.querySelectorAll('.sequence-note-current')).toHaveLength(1);
      expect(container.querySelectorAll('.sequence-note-todo')).toHaveLength(1);
      expect(container.querySelectorAll('.sequence-note-hit')).toHaveLength(0);
      expect(container.querySelectorAll('.sequence-note-miss')).toHaveLength(0);
      // The cursor's OWN entry carries `current`, its own resting state — not
      // `todo` with the rest of the future, and not a verdict of any kind.
      expect(container.querySelector('[data-sequence-index="2"] .action-staff__note').getAttribute('class'))
        .toContain('sequence-note-current');
    });

    it('marks nothing done at the start of a run — the cursor rests black, the rest brown', () => {
      const { container } = render(<SvgSequenceStaff notes={notes(60, 62, 64)} cursorIndex={0} />);
      expect(container.querySelectorAll('.sequence-note-done')).toHaveLength(0);
      expect(container.querySelectorAll('.sequence-note-current')).toHaveLength(1);
      expect(container.querySelectorAll('.sequence-note-todo')).toHaveLength(2);
    });

    it('marks everything done once the sequence is complete', () => {
      const { container } = render(<SvgSequenceStaff notes={notes(60, 62, 64)} cursorIndex={3} />);
      expect(container.querySelectorAll('.sequence-note-done')).toHaveLength(3);
      expect(container.querySelectorAll('.sequence-note-todo')).toHaveLength(0);
    });

    it('classes every notehead of a resting simultaneous cursor entry alike', () => {
      const { container } = render(
        <SvgSequenceStaff notes={[{ midis: [60, 64, 67] }, { midi: 72 }]} cursorIndex={0} />
      );
      // Entry-level, so all three heads of the chord share one treatment; the
      // single note after it is the only brown thing on the staff.
      expect(container.querySelectorAll('.sequence-note-current')).toHaveLength(3);
      expect(container.querySelectorAll('.sequence-note-todo')).toHaveLength(1);
    });

    it('never sets a partial-opacity attribute on a notated notehead, done or todo', () => {
      const { container } = render(<SvgSequenceStaff notes={notes(60, 62, 64)} cursorIndex={1} />);
      for (const note of container.querySelectorAll('.action-staff__note')) {
        expect(note.getAttribute('opacity')).toBeNull();
      }
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

  // ── An attempt in progress at the cursor (rule 2 + 5) ──────────────────────
  // Colour is per NOTE, scoped to the cursor's own entry, and gated entirely on
  // whether anything is currently held — never a remembered flag.
  describe('an attempt in progress at the cursor', () => {
    it('renders the plain resting cursor, not miss, when nothing at all is held', () => {
      // Rule 5, the one this whole model hinges on: an unplayed note is not a
      // standing accusation. No keys down means no verdict of any kind.
      const { container } = render(<SvgSequenceStaff notes={notes(60, 62, 64)} cursorIndex={1} />);
      expect(container.querySelectorAll('.sequence-note-miss')).toHaveLength(0);
      expect(container.querySelectorAll('.sequence-note-hit')).toHaveLength(0);
      expect(container.querySelector('[data-sequence-index="1"] .action-staff__note').getAttribute('class'))
        .toContain('sequence-note-current');
    });

    it('colours a held single-note target green, with a green stem', () => {
      const active = new Map([[62, { velocity: 80 }]]);
      const { container } = render(
        <SvgSequenceStaff notes={notes(60, 62, 64)} cursorIndex={1} activeNotes={active} />
      );
      const hit = container.querySelector('.sequence-note-hit');
      expect(hit).toBeTruthy();
      expect(hit.getAttribute('data-midi')).toBe('62');
      expect(container.querySelectorAll('.sequence-note-miss')).toHaveLength(0);
      expect(
        container.querySelector('[data-sequence-index="1"]').getAttribute('data-stem-state')
      ).toBe('hit');
    });

    it('colours the cursor target red — plus a stemless ghost — when a DIFFERENT pitch is held', () => {
      const active = new Map([[61, { velocity: 80 }]]); // a semitone under the expected 62
      const { container } = render(
        <SvgSequenceStaff notes={notes(60, 62, 64)} cursorIndex={1} activeNotes={active} />
      );
      const miss = container.querySelector('.sequence-note-miss');
      expect(miss).toBeTruthy();
      expect(miss.getAttribute('data-midi')).toBe('62');
      expect(container.querySelectorAll('.sequence-note-hit')).toHaveLength(0);
      expect(
        container.querySelector('[data-sequence-index="1"]').getAttribute('data-stem-state')
      ).toBe('miss');
      const ghost = container.querySelector('.sequence-note-wrong-ghost');
      expect(ghost.getAttribute('data-midi')).toBe('61');
    });

    it('the owner\'s worked example: a chord with the top two held and the bottom not — two green, one red, NO ghost', () => {
      const active = new Map([[64, { velocity: 80 }], [67, { velocity: 80 }]]);
      const { container } = render(
        <SvgSequenceStaff notes={[{ midis: [60, 64, 67] }]} cursorIndex={0} activeNotes={active} />
      );
      expect(container.querySelectorAll('.sequence-note-hit')).toHaveLength(2);
      expect(container.querySelectorAll('.sequence-note-miss')).toHaveLength(1);
      expect(container.querySelector('.sequence-note-miss').getAttribute('data-midi')).toBe('60');
      // The chord being incomplete is not the same as playing something wrong:
      // every pitch that WAS played was on target, so there is nothing to ghost.
      expect(container.querySelectorAll('.sequence-note-wrong-ghost')).toHaveLength(0);
    });

    it('the resting cursor gets its OWN stem state, never `done`', () => {
      // `done` is the brown "already played" ink. When the cursor entry shared
      // that stem state, the note being read wore a brown stem under a black
      // notehead. Past is brown, present and future are black.
      const { container } = render(<SvgSequenceStaff notes={notes(60, 62, 64)} cursorIndex={1} />);
      const at = (i) => container.querySelector(`[data-sequence-index="${i}"]`).getAttribute('data-stem-state');
      expect(at(0)).toBe('done');     // behind the cursor — brown
      expect(at(1)).toBe('current');  // the cursor itself — black
      expect(at(2)).toBe('todo');     // ahead of the cursor — black
    });

    it('a mixed chord leaves the shared stem uncoloured — no verdict for the whole chord', () => {
      const active = new Map([[64, { velocity: 80 }]]); // only the middle note of the triad
      const { container } = render(
        <SvgSequenceStaff notes={[{ midis: [60, 64, 67] }]} cursorIndex={0} activeNotes={active} />
      );
      expect(
        container.querySelector('[data-sequence-index="0"]').getAttribute('data-stem-state')
      ).toBe('mixed');
    });

    it('a fully missed chord reds every target and colours the stem — no note played was correct', () => {
      const active = new Map([[99, { velocity: 80 }]]); // nothing to do with this chord
      const { container } = render(
        <SvgSequenceStaff notes={[{ midis: [60, 64, 67] }]} cursorIndex={0} activeNotes={active} />
      );
      expect(container.querySelectorAll('.sequence-note-miss')).toHaveLength(3);
      expect(container.querySelectorAll('.sequence-note-hit')).toHaveLength(0);
      expect(
        container.querySelector('[data-sequence-index="0"]').getAttribute('data-stem-state')
      ).toBe('miss');
    });

    it('a fully hit chord greens every target and the stem alike', () => {
      const active = new Map([[60, {}], [64, {}], [67, {}]]);
      const { container } = render(
        <SvgSequenceStaff notes={[{ midis: [60, 64, 67] }]} cursorIndex={0} activeNotes={active} />
      );
      expect(container.querySelectorAll('.sequence-note-hit')).toHaveLength(3);
      expect(
        container.querySelector('[data-sequence-index="0"]').getAttribute('data-stem-state')
      ).toBe('hit');
    });

    it('never colours an entry other than the cursor\'s, even mid-attempt', () => {
      const active = new Map([[62, { velocity: 80 }]]);
      const { container } = render(
        <SvgSequenceStaff notes={notes(60, 62, 64)} cursorIndex={1} activeNotes={active} />
      );
      expect(container.querySelector('[data-sequence-index="0"]').getAttribute('data-state')).toBe('done');
      expect(container.querySelector('[data-sequence-index="2"]').getAttribute('data-state')).toBe('todo');
    });

    it('everything reverts to the resting cursor and the ghost clears the instant nothing is held (rule 4)', () => {
      const held = new Map([[61, { velocity: 80 }]]);
      const { container, rerender } = render(
        <SvgSequenceStaff notes={notes(60, 62, 64)} cursorIndex={1} activeNotes={held} />
      );
      expect(container.querySelectorAll('.sequence-note-miss')).toHaveLength(1);
      expect(container.querySelectorAll('.sequence-note-wrong-ghost')).toHaveLength(1);

      rerender(<SvgSequenceStaff notes={notes(60, 62, 64)} cursorIndex={1} activeNotes={new Map()} />);
      expect(container.querySelectorAll('.sequence-note-miss')).toHaveLength(0);
      expect(container.querySelectorAll('.sequence-note-hit')).toHaveLength(0);
      expect(container.querySelectorAll('.sequence-note-wrong-ghost')).toHaveLength(0);
      expect(container.querySelector('[data-sequence-index="1"] .action-staff__note').getAttribute('class'))
        .toContain('sequence-note-current');
    });
  });

  // ── The ghost: a held pitch that is not one of the CURSOR ENTRY's targets ──
  describe('the off-target ghost', () => {
    it('adds exactly one ghost notehead without disturbing the targets', () => {
      const active = new Map([[65, { velocity: 80 }]]);
      const { container } = render(
        <SvgSequenceStaff notes={notes(60, 62, 64)} cursorIndex={1} activeNotes={active} />
      );
      expect(container.querySelectorAll('.action-staff__note')).toHaveLength(3);
      expect(container.querySelectorAll('.sequence-note-wrong-ghost')).toHaveLength(1);
    });

    it('renders no ghost when nothing is held', () => {
      const { container } = render(<SvgSequenceStaff notes={notes(60, 62, 64)} cursorIndex={1} />);
      expect(container.querySelectorAll('.sequence-note-wrong-ghost')).toHaveLength(0);
    });

    it('sits at its OWN staff position, not the target\'s', () => {
      // Target at the cursor is D4 (62); the child is holding F4 (65). The
      // ghost must sit where an F4 belongs, which is a different line offset.
      const active = new Map([[65, { velocity: 80 }]]);
      const { container } = render(
        <SvgSequenceStaff notes={notes(60, 62, 64)} cursorIndex={1} activeNotes={active} />
      );
      const [ghost] = lineOffsets(container, '.sequence-note-wrong-ghost');
      const target = Number(
        container.querySelector('.sequence-note-miss').getAttribute('data-line-offset')
      );
      expect(ghost).toBe(1); // F4 on treble
      expect(target).toBe(-1); // D4 on treble
      expect(ghost).not.toBe(target);
    });

    it('reads the ghost on the CHOSEN clef too', () => {
      const active = new Map([[65, { velocity: 80 }]]);
      const { container } = render(
        <SvgSequenceStaff notes={notes(60, 62)} clef="bass" cursorIndex={0} activeNotes={active} />
      );
      expect(lineOffsets(container, '.sequence-note-wrong-ghost')).toEqual([13]); // F4 on bass
    });

    it('stands near the cursor column so the child can compare', () => {
      const active = new Map([[61, { velocity: 80 }]]);
      const { container } = render(
        <SvgSequenceStaff notes={notes(60, 62, 64, 65)} cursorIndex={2} activeNotes={active} />
      );
      const ghostX = Number(container.querySelector('.sequence-note-wrong-ghost').getAttribute('cx'));
      const cursorX = Number(container.querySelector('.sequence-note-miss').getAttribute('cx'));
      const nextColX = Number(
        container.querySelector('[data-sequence-index="3"] .action-staff__note').getAttribute('cx')
      );
      expect(ghostX).toBeGreaterThan(cursorX);
      expect(ghostX).toBeLessThan(nextColX);
    });

    it('draws the accidental of a held black key that is off-target', () => {
      const active = new Map([[61, { velocity: 80 }]]);
      const { container } = render(
        <SvgSequenceStaff notes={notes(60, 62)} cursorIndex={0} activeNotes={active} />
      );
      const acc = container.querySelector('.sequence-staff__ghost-accidental');
      expect(acc).toBeTruthy();
      expect(acc.querySelector('text')).toBeNull();
      expect(acc.querySelectorAll('path, line').length).toBeGreaterThan(0);
    });

    it('carries no stem of its own', () => {
      const active = new Map([[65, { velocity: 80 }]]);
      const { container } = render(
        <SvgSequenceStaff notes={notes(60, 62, 64)} cursorIndex={1} activeNotes={active} />
      );
      const ghostGroup = container.querySelector('.sequence-staff__ghost');
      expect(ghostGroup.querySelector('.action-staff__stem')).toBeNull();
    });

    it('never ghosts a key that is one of the CURSOR ENTRY\'s own targets', () => {
      const active = new Map([[60, { velocity: 80 }]]);
      const { container } = render(
        <SvgSequenceStaff notes={notes(60, 62, 64)} cursorIndex={0} activeNotes={active} />
      );
      expect(container.querySelectorAll('.sequence-note-wrong-ghost')).toHaveLength(0);
    });

    it('DOES ghost a held key that matches some OTHER entry\'s target — "the target" is scoped to the cursor', () => {
      // 60 is entry 0's own note, already played (done); the cursor is on
      // entry 1 (62). Holding 60 right now is not what entry 1 is asking for,
      // so it is exactly as off-target as any other wrong pitch.
      const active = new Map([[60, { velocity: 80 }]]);
      const { container } = render(
        <SvgSequenceStaff notes={notes(60, 62, 64)} cursorIndex={1} activeNotes={active} />
      );
      const ghost = container.querySelector('.sequence-note-wrong-ghost');
      expect(ghost).toBeTruthy();
      expect(ghost.getAttribute('data-midi')).toBe('60');
      expect(container.querySelector('.sequence-note-miss').getAttribute('data-midi')).toBe('62');
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

// ─────────────────────────────────────────────────────────────────────────────
/**
 * THE AFTERGLOW. Reported from the piano kiosk: a child playing a clean scale,
 * cursor advancing correctly, score 1.0 — and a ghost note appearing on every
 * note, one beat behind. Production (`piano.exercise-midi-state`, 21:24) shows
 * why: a scale is legato, and up to THREE keys are down at once.
 *
 *     [60]        -> [60,62]       onsets [62]
 *     [60,62]     -> [60,62,64]    onsets [64]
 *     [60,62,64]  -> [62,64]       releases [60]
 *
 * The instant the cursor advanced to 62, the still-held 60 stopped matching the
 * target and was drawn as a wrong note. Nothing was played wrong; the finger had
 * simply not left the key yet.
 */
describe('a sustained note is not a mistake', () => {
  afterEach(() => { vi.useRealTimers(); });

  const at = (ms) => ({ velocity: 80, timestamp: ms });

  it('draws NO ghost for a key still held from the previous note', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    // Cursor on 60; 60 pressed and held.
    const { container, rerender } = render(
      <SvgSequenceStaff notes={notes(60, 62, 64)} cursorIndex={0} activeNotes={new Map([[60, at(1000)]])} />
    );

    // 62 goes down at 2000 and the cursor advances — 60 has NOT been released.
    vi.setSystemTime(2000);
    rerender(
      <SvgSequenceStaff notes={notes(60, 62, 64)} cursorIndex={1}
        activeNotes={new Map([[60, at(1000)], [62, at(2000)]])} />
    );

    expect(container.querySelectorAll('.sequence-note-wrong-ghost')).toHaveLength(0);
    // And the note actually being played still reads as correct.
    expect(container.querySelector('.sequence-note-hit')?.getAttribute('data-midi')).toBe('62');
  });

  it('survives a three-deep legato overlap — the real scale', () => {
    vi.useFakeTimers();
    vi.setSystemTime(3000);
    const { container, rerender } = render(
      <SvgSequenceStaff notes={notes(60, 62, 64)} cursorIndex={1}
        activeNotes={new Map([[60, at(1000)], [62, at(3000)]])} />
    );
    vi.setSystemTime(4000);
    rerender(
      <SvgSequenceStaff notes={notes(60, 62, 64)} cursorIndex={2}
        activeNotes={new Map([[60, at(1000)], [62, at(3000)], [64, at(4000)]])} />
    );
    expect(container.querySelectorAll('.sequence-note-wrong-ghost')).toHaveLength(0);
    expect(container.querySelector('.sequence-note-hit')?.getAttribute('data-midi')).toBe('64');
  });

  it('STILL ghosts a wrong note pressed after the cursor arrived', () => {
    vi.useFakeTimers();
    vi.setSystemTime(2000);
    const { container, rerender } = render(
      <SvgSequenceStaff notes={notes(60, 62, 64)} cursorIndex={1}
        activeNotes={new Map([[60, at(1000)]])} />
    );
    // Same cursor entry, so its arrival clock does not move: 61 is a fresh
    // answer to THIS note, and a wrong one.
    vi.setSystemTime(2500);
    rerender(
      <SvgSequenceStaff notes={notes(60, 62, 64)} cursorIndex={1}
        activeNotes={new Map([[60, at(1000)], [61, at(2500)]])} />
    );
    const ghosts = container.querySelectorAll('.sequence-note-wrong-ghost');
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0].getAttribute('data-midi')).toBe('61');
  });

  /**
   * The owner's call, 2026-09-11: anything still held from before this cursor
   * goes quiet, INCLUDING a key that was wrong when it went down. The rejected
   * alternative was to keep ghosting a stale wrong note until release. Pinned
   * here because a comment can be ignored and this cannot.
   */
  it('a WRONG note held across an advance also goes quiet — anything still held is stale', () => {
    vi.useFakeTimers();
    // The cursor arrives at 62 with nothing held...
    vi.setSystemTime(2000);
    const { container, rerender } = render(
      <SvgSequenceStaff notes={notes(60, 62, 64)} cursorIndex={1} activeNotes={new Map()} />
    );
    // ...and THEN the child presses 61 by mistake and keeps holding it. The
    // press has to land after the arrival, which is the real order of events —
    // a tie is a sustain by design (see classifyHeldPitch).
    vi.setSystemTime(2100);
    rerender(
      <SvgSequenceStaff notes={notes(60, 62, 64)} cursorIndex={1}
        activeNotes={new Map([[61, at(2100)]])} />
    );
    expect(container.querySelectorAll('.sequence-note-wrong-ghost')).toHaveLength(1);

    // They then find 64 and the cursor advances — 61 is STILL down.
    vi.setSystemTime(3000);
    rerender(
      <SvgSequenceStaff notes={notes(60, 62, 64)} cursorIndex={2}
        activeNotes={new Map([[61, at(2100)], [64, at(3000)]])} />
    );
    expect(container.querySelectorAll('.sequence-note-wrong-ghost')).toHaveLength(0);
    expect(container.querySelector('.sequence-note-hit')?.getAttribute('data-midi')).toBe('64');
  });

  it('a held key with no press time is still ghosted — provenance unknown, do not hide it', () => {
    const { container } = render(
      <SvgSequenceStaff notes={notes(60, 62, 64)} cursorIndex={1}
        activeNotes={new Map([[61, { velocity: 80 }]])} />
    );
    expect(container.querySelectorAll('.sequence-note-wrong-ghost')).toHaveLength(1);
  });
});

describe('classifyHeldPitch', () => {
  const targets = new Set([62]);

  it('a target is a target, whenever it was pressed', () => {
    expect(classifyHeldPitch(62, { pressedAt: 1, cursorArrivedAt: 1000, cursorTargets: targets })).toBe('target');
  });

  it('pressed after the cursor arrived is a ghost', () => {
    expect(classifyHeldPitch(61, { pressedAt: 1500, cursorArrivedAt: 1000, cursorTargets: targets })).toBe('ghost');
  });

  it('pressed before the cursor arrived is a sustain', () => {
    expect(classifyHeldPitch(60, { pressedAt: 500, cursorArrivedAt: 1000, cursorTargets: targets })).toBe('sustain');
  });

  it('a tie counts as a sustain — never accuse a child on a rounding error', () => {
    expect(classifyHeldPitch(60, { pressedAt: 1000, cursorArrivedAt: 1000, cursorTargets: targets })).toBe('sustain');
  });

  it('an unknown press time falls back to ghost', () => {
    expect(classifyHeldPitch(61, { pressedAt: undefined, cursorArrivedAt: 1000, cursorTargets: targets })).toBe('ghost');
    expect(classifyHeldPitch(61, { pressedAt: 1500, cursorArrivedAt: NaN, cursorTargets: targets })).toBe('ghost');
  });
});
