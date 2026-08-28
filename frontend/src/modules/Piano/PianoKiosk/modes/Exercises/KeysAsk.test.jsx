import { cleanup, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import KeysAsk from './KeysAsk.jsx';

// Both children are boundary-mocked so this spec pins the CONTRACT KeysAsk
// hands them — which midis are lit, which cursor/wrong midi went to the
// staff — rather than re-testing PianoKeyboard/SvgSequenceStaff's own
// rendering, which each already have their own suite.
vi.mock('../../../components/PianoKeyboard.jsx', () => ({
  PianoKeyboard: (props) => (
    <div
      data-testid="keyboard"
      data-target={[...(props.targetNotes ?? new Map()).keys()].sort((a, b) => a - b).join(',')}
      data-wrong={[...(props.wrongNotes ?? [])].join(',')}
      data-start={props.startNote}
      data-end={props.endNote}
      data-dim={String(!!props.dimTarget)}
    />
  ),
}));
// …with ONE exception: the clef case below has to see real engraving, because
// what it is checking is where a notehead lands on the page. `h.realStaff`
// swaps the double for the actual component for that test alone.
const h = vi.hoisted(() => ({ realStaff: false }));
vi.mock('../../../../MusicNotation/renderers/SvgSequenceStaff.jsx', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    SvgSequenceStaff: (props) => (h.realStaff ? <actual.SvgSequenceStaff {...props} /> : (
      <div
        data-testid="sequence-staff"
        data-cursor={props.cursorIndex}
        data-wrong={props.wrongMidi ?? ''}
        data-accidental={props.accidental}
        data-clef={props.clef ?? ''}
        data-notes={JSON.stringify(props.notes)}
      />
    )),
  };
});

const note = (midi) => ({ midi });
const event = (...midis) => ({ notes: midis.map(note) });

describe('KeysAsk', () => {
  it('a together-ask (one event, many notes) lights every target midi at once', () => {
    render(<KeysAsk events={[event(60, 64, 67)]} cursorIndex={0} />);
    expect(screen.getByTestId('keyboard')).toHaveAttribute('data-target', '60,64,67');
  });

  it('a sequence-ask lights only event cursorIndex\'s notes', () => {
    const events = [event(60), event(62), event(64)];
    render(<KeysAsk events={events} cursorIndex={1} />);
    expect(screen.getByTestId('keyboard')).toHaveAttribute('data-target', '62');

    // The cursor moving is the whole point — re-render one step on and prove
    // the lit set moved with it rather than being computed once.
    const { rerender } = render(<KeysAsk events={events} cursorIndex={0} />);
    rerender(<KeysAsk events={events} cursorIndex={2} />);
    expect(screen.getAllByTestId('keyboard').at(-1)).toHaveAttribute('data-target', '64');
  });

  it('renders no badges for a single-event together-ask', () => {
    render(<KeysAsk events={[event(60, 64)]} cursorIndex={0} />);
    expect(document.querySelectorAll('.keys-ask__badge')).toHaveLength(0);
  });

  it('badges render 1..n for an in-order ask, and advance as the cursor does', () => {
    const events = [event(60), event(62), event(64)];
    const { rerender } = render(<KeysAsk events={events} cursorIndex={0} />);
    let badges = [...document.querySelectorAll('.keys-ask__badge')];
    expect(badges.map((b) => b.textContent)).toEqual(['1', '2', '3']);
    expect(badges.map((b) => b.className)).toEqual([
      'keys-ask__badge is-current',
      'keys-ask__badge',
      'keys-ask__badge',
    ]);

    rerender(<KeysAsk events={events} cursorIndex={2} />);
    badges = [...document.querySelectorAll('.keys-ask__badge')];
    // Done ones dim; the badge AT the cursor reads current; nothing after it
    // has fired yet.
    expect(badges.map((b) => b.className)).toEqual([
      'keys-ask__badge is-done',
      'keys-ask__badge is-done',
      'keys-ask__badge is-current',
    ]);
  });

  it('showStaff toggles the presence of SvgSequenceStaff and passes it the same cursor/wrong/accidental', () => {
    const events = [event(60), event(64)];
    const { rerender } = render(
      <KeysAsk events={events} cursorIndex={1} wrongMidi={61} showStaff={false} accidental="flat" />
    );
    expect(screen.queryByTestId('sequence-staff')).not.toBeInTheDocument();

    rerender(<KeysAsk events={events} cursorIndex={1} wrongMidi={61} showStaff accidental="flat" />);
    const staff = screen.getByTestId('sequence-staff');
    expect(staff).toHaveAttribute('data-cursor', '1');
    expect(staff).toHaveAttribute('data-wrong', '61');
    expect(staff).toHaveAttribute('data-accidental', 'flat');
    expect(JSON.parse(staff.getAttribute('data-notes'))).toEqual([{ midi: 60 }, { midi: 64 }]);
  });

  // ── The clef. Left to the staff it is re-derived from the majority of the
  // pitches, and a TIE goes treble — which is how a two-note bass ask ends up
  // drawn below the bottom of the card.

  it('forwards the clef it was given', () => {
    render(<KeysAsk events={[event(55), event(60)]} cursorIndex={0} showStaff clef="bass" />);
    expect(screen.getByTestId('sequence-staff')).toHaveAttribute('data-clef', 'bass');
  });

  it('answers with the ask\'s own clef when the host named none', () => {
    // Same rule the host uses to decide the staff may be shown at all
    // (`clefForAsk`), so the two cannot disagree.
    render(<KeysAsk events={[event(55), event(60)]} cursorIndex={0} showStaff />);
    expect(screen.getByTestId('sequence-staff')).toHaveAttribute('data-clef', 'bass');
    cleanup();
    render(<KeysAsk events={[event(60), event(64)]} cursorIndex={0} showStaff />);
    expect(screen.getByTestId('sequence-staff')).toHaveAttribute('data-clef', 'treble');
  });

  it('draws a low two-note ask on a bass staff, both noteheads on the page', () => {
    // G3 + C4: one pitch each side of the treble/bass boundary, so the
    // majority rule ties and falls to treble — where G3 sits at position -5,
    // below the bottom of a viewBox that only reaches -3. Real engraving, not
    // the double, because the failure is WHERE the ink lands.
    h.realStaff = true;
    try {
      render(<KeysAsk events={[event(55), event(60)]} cursorIndex={0} showStaff />);
      expect(document.querySelector('.sequence-staff')).toHaveAttribute('data-clef', 'bass');
      const offsets = [...document.querySelectorAll('.action-staff__note')]
        .map((note) => Number(note.getAttribute('data-line-offset')));
      expect(offsets).toEqual([7, 10]); // G3 and C4, both on a bass staff
      // The band the staff draws within: two ledger lines either side.
      for (const offset of offsets) {
        expect(offset).toBeGreaterThanOrEqual(-3);
        expect(offset).toBeLessThanOrEqual(11);
      }
    } finally {
      h.realStaff = false;
    }
  });

  it('showStaff defaults to false when omitted', () => {
    render(<KeysAsk events={[event(60)]} cursorIndex={0} />);
    expect(screen.queryByTestId('sequence-staff')).not.toBeInTheDocument();
  });

  it('a wrong press flows through to the keyboard\'s wrongNotes, and clears back to null', () => {
    const events = [event(60)];
    const { rerender } = render(<KeysAsk events={events} cursorIndex={0} wrongMidi={61} />);
    expect(screen.getByTestId('keyboard')).toHaveAttribute('data-wrong', '61');

    rerender(<KeysAsk events={events} cursorIndex={0} wrongMidi={null} />);
    expect(screen.getByTestId('keyboard')).toHaveAttribute('data-wrong', '');
  });

  it('ranges the keyboard to the whole ask, +/-3 semitones', () => {
    const events = [event(60), event(64)];
    render(<KeysAsk events={events} cursorIndex={0} />);
    const kb = screen.getByTestId('keyboard');
    expect(kb).toHaveAttribute('data-start', '57'); // 60 - 3
    expect(kb).toHaveAttribute('data-end', '67'); // 64 + 3
  });

  it('clamps the range at the ends of the piano, exactly like ExerciseRun', () => {
    const events = [event(22), event(107)];
    render(<KeysAsk events={events} cursorIndex={0} />);
    const kb = screen.getByTestId('keyboard');
    expect(kb).toHaveAttribute('data-start', '21');
    expect(kb).toHaveAttribute('data-end', '108');
  });

  it('lights the target keys at full brightness — a spoiler, not a hint', () => {
    // dimTarget is the muted "reveal after a miss" treatment Sheet Music Learn
    // mode uses. A preschooler reading "press the lit key" needs the full glow.
    render(<KeysAsk events={[event(60)]} cursorIndex={0} />);
    expect(screen.getByTestId('keyboard')).toHaveAttribute('data-dim', 'false');
  });
});
