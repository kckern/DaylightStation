import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { WrongNoteGhost } from './WrongNoteGhost.jsx';

// jsdom reports every box as zero, so the staff is stubbed with the geometry
// measured off the deployed card game (5 lines, 21px apart, top line at y=394).
// The component only ever asks the container for `.abcjs-staff` children and
// boxes, so a stub answering those is the whole surface it touches.
const rect = (top, height, extra = {}) => ({ top, height, left: 0, right: 0, ...extra });
const LINE_TOPS = [394, 415, 436, 457, 478];

function staffStub({ containerTop = 220, containerLeft = 57, anchorRight = 281 } = {}) {
  return {
    container: {
      querySelectorAll: () => LINE_TOPS.map((top) => ({ getBoundingClientRect: () => rect(top, 2) })),
      getBoundingClientRect: () => rect(containerTop, 428, { left: containerLeft, right: 1223 }),
    },
    anchor: { getBoundingClientRect: () => rect(400, 84, { left: 254, right: anchorRight }) },
  };
}

const noteheadCy = (container) => {
  const head = container.querySelector('.piano-scale-ghost__head');
  return head ? Number(head.getAttribute('cy')) : null;
};

describe('WrongNoteGhost', () => {
  const { container: staff, anchor } = staffStub();

  it('writes the played pitch on its own staff line, measured off the live engraving', () => {
    // Top line (y 395) is F5 on a treble staff; the lines run 21px apart, so a
    // pitch N diatonic steps below the top line sits N × 10.5px lower. B4 is 4
    // steps below F5 → 395 + 42 = 437, reported in the overlay's space (−220).
    const { container } = render(
      <WrongNoteGhost container={staff} anchor={anchor} midi={71} clefType="treble" keyName="C" />,
    );
    expect(noteheadCy(container)).toBeCloseTo(437 - 220, 5);
  });

  it('moves a step per pitch, in the right direction', () => {
    const at = (midi) => {
      const { container } = render(
        <WrongNoteGhost container={staff} anchor={anchor} midi={midi} clefType="treble" keyName="C" />,
      );
      return noteheadCy(container);
    };
    // C5 is one diatonic step above B4 → half a space (10.5px) HIGHER on screen.
    expect(at(72)).toBeCloseTo(at(71) - 10.5, 5);
    // A4 is one step below → the same distance lower.
    expect(at(69)).toBeCloseTo(at(71) + 10.5, 5);
  });

  it('draws ledger lines for a pitch off the staff, so it can still be read', () => {
    // C4 (middle C) is two steps below the treble staff — without its ledger it
    // is a notehead floating in white space.
    const { container } = render(
      <WrongNoteGhost container={staff} anchor={anchor} midi={60} clefType="treble" keyName="C" />,
    );
    expect(container.querySelectorAll('.piano-scale-ghost__ledger').length).toBeGreaterThan(0);
  });

  it('clears the notehead it is compared against', () => {
    const { container } = render(
      <WrongNoteGhost container={staff} anchor={anchor} midi={71} clefType="treble" keyName="C" />,
    );
    const head = container.querySelector('.piano-scale-ghost__head');
    // Right of the expected note's box (281 − 57 = 224 in overlay space), so a
    // same-line mistake does not land on top of the red mark.
    expect(Number(head.getAttribute('cx'))).toBeGreaterThan(224);
  });

  it('renders nothing rather than a wrong note when it cannot place one', () => {
    const cases = [
      { container: staff, anchor, midi: null, clefType: 'treble' },       // nothing played
      { container: staff, anchor, midi: 71, clefType: 'alto' },           // unplaceable clef
      { container: staff, anchor: null, midi: 71, clefType: 'treble' },   // note not engraved
      { container: null, anchor, midi: 71, clefType: 'treble' },          // staff not mounted
    ];
    for (const props of cases) {
      const { container } = render(<WrongNoteGhost {...props} keyName="C" />);
      expect(container.querySelector('.piano-scale-ghost')).toBeNull();
    }
  });
});
