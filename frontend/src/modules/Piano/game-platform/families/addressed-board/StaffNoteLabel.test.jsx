import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import StaffNoteLabel from './StaffNoteLabel.jsx';
import { managedAddressingAt } from '../../addressing/managedAddressing.js';
import { chessAddressingFor } from '../../../PianoChessGame/chessAddressingModel.js';
import { DEFAULT_CHORD_SCHEME } from '../../../PianoChessGame/chordAddress.js';
import { staffTokenNotes } from '../../../PianoChessGame/staffAddress.js';
import {
  clefRightEdge, ACCIDENTAL_INK_LEFT, NOTEHEAD_RX,
} from '../../../../MusicNotation/renderers/staffGlyphs.jsx';

const ghosts = (c) => c.querySelectorAll('.action-staff__ghost');
const card = (c) => c.querySelector('.chess-staff-label');

describe('StaffNoteLabel', () => {
  it('draws the note it names', () => {
    const { container } = render(<StaffNoteLabel midi={60} />);
    expect(container.querySelectorAll('.action-staff__note')).toHaveLength(1);
  });

  it('draws every note of a multi-note card', () => {
    const { container } = render(<StaffNoteLabel midi={[60, 64, 67]} />);
    expect(container.querySelectorAll('.action-staff__note')).toHaveLength(3);
  });

  // THE CHANNEL THAT WAS MISSING. SvgStaffRenderer could always draw the keys
  // currently down and nothing ever passed them, so the board's entire reply to
  // a wrong press was "that chord is not on the board" — a child walking up the
  // scale toward a note learned nothing from getting closer.
  describe('ghost notes', () => {
    it('draws the held keys that land on this card', () => {
      const { container } = render(<StaffNoteLabel midi={60} held={[64, 67]} />);
      expect(ghosts(container)).toHaveLength(2);
    });

    it('draws none when the host passes none — the cue is the host\'s to switch off', () => {
      expect(ghosts(render(<StaffNoteLabel midi={60} />).container)).toHaveLength(0);
      expect(ghosts(render(<StaffNoteLabel midi={60} held={[]} />).container)).toHaveLength(0);
      expect(ghosts(render(<StaffNoteLabel midi={60} held={null} />).container)).toHaveLength(0);
    });

    it('does not ghost a key that is already this card\'s answer', () => {
      const { container } = render(<StaffNoteLabel midi={[60, 67]} held={[60, 67]} />);
      expect(ghosts(container)).toHaveLength(0);
    });

    it('skips a key too far off this card to say anything', () => {
      const { container } = render(<StaffNoteLabel midi={72} held={[36]} />);
      expect(ghosts(container)).toHaveLength(0);
    });
  });

  // A square takes two hands, and the board used to answer about both at once:
  // a correct right hand earned nothing until the left one landed, so it got
  // thrown away and guessed again on every attempt.
  describe('the locked hand', () => {
    it('is plain by default', () => {
      const { container } = render(<StaffNoteLabel midi={60} />);
      expect(card(container).className).not.toContain('locked');
      expect(card(container)).not.toHaveAttribute('data-locked');
      expect(container.querySelectorAll('.action-staff__note--matched')).toHaveLength(0);
    });

    it('turns the card and its ink green together', () => {
      const { container } = render(<StaffNoteLabel midi={[60, 67]} locked />);
      expect(card(container).className).toContain('chess-staff-label--locked');
      // The shared green treatment the other piano staves already use, so the
      // card and the notes on it never disagree about whether this is right.
      expect(card(container).className).toContain('action-staff--matched');
      expect(card(container)).toHaveAttribute('data-locked', 'true');
      expect(container.querySelectorAll('.action-staff__note--matched')).toHaveLength(2);
    });
  });

  it('spells black keys the way the board tells it to', () => {
    const sharp = render(<StaffNoteLabel midi={70} accidental="sharp" />).container;
    const flat = render(<StaffNoteLabel midi={70} accidental="flat" />).container;
    expect(sharp.querySelector('.action-staff__accidental')).toHaveAttribute('data-kind', 'sharp');
    expect(flat.querySelector('.action-staff__accidental')).toHaveAttribute('data-kind', 'flat');
  });
});

/**
 * The rim card has to hold every shape the addressing ladder can deal it, on a
 * staff 100 units wide that has already spent a third of that on a clef.
 *
 * The hardest of them is real and reachable: a bass-clef triad, on the tier
 * that carries accidentals, with two of them and a notehead displaced across
 * the stem. A rank rim full of those was what "the rendering is kind of dirty"
 * meant — accidentals drawn straight through the clef.
 */
describe('every shape the ladder can deal keeps its ink off the clef', () => {
  const CFG = {
    enabled: true,
    cadence: { order: 'shuffled', shuffle: 'each_turn' },
    users: { learner: { vocabulary: 'staff', startStage: 0 } },
  };

  it('clears the clef at every stage, on every deal', () => {
    const collisions = [];
    for (let completedGames = 0; completedGames <= 5; completedGames += 1) {
      const managed = managedAddressingAt(CFG, { learnerId: 'learner', completedGames });
      for (let seed = 0; seed < 12; seed += 1) {
        const { scheme } = chessAddressingFor({}, DEFAULT_CHORD_SCHEME, seed, managed);
        for (const token of [...scheme.roots, ...scheme.qualities]) {
          const pitches = staffTokenNotes(token);
          const { container } = render(<StaffNoteLabel midi={pitches} />);
          const lefts = [
            ...[...container.querySelectorAll('.action-staff__note')]
              .map((n) => Number(n.getAttribute('cx')) - NOTEHEAD_RX),
            ...[...container.querySelectorAll('.action-staff__accidental')].map((a) => {
              const x = Number(/translate\(([-\d.]+)/.exec(a.getAttribute('transform'))[1]);
              return x - ACCIDENTAL_INK_LEFT[a.getAttribute('data-kind')];
            }),
          ];
          const leftmost = Math.min(...lefts);
          // A hair of tolerance: the bound and the shift are computed from the
          // same floats and the tightest shapes land exactly on it.
          if (leftmost < clefRightEdge(14) - 0.01) {
            collisions.push({ completedGames, seed, pitches, leftmost: Math.round(leftmost * 10) / 10 });
          }
        }
      }
    }
    expect(
      collisions.sort((a, b) => a.leftmost - b.leftmost).slice(0, 5),
      `the clef's right edge is ${clefRightEdge(14)}`,
    ).toEqual([]);
  });
});
