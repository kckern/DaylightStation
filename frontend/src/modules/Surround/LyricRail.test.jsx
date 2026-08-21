/**
 * The lyric rail, at the seam that matters: which column the FRAME wears.
 *
 * The module's own text handling is asserted through the frame rather than in
 * isolation, because "the words are on screen" and "the programme rail is not"
 * are one fact, and a module test could pass while the frame showed both.
 */

import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import SurroundFrame from './SurroundFrame.jsx';
import { resetSurroundRegistry } from './registry.js';
import { registerSurroundBuiltins } from './builtins.js';

const seg = (over) => ({
  contentId: 'w1', start: 0, end: 10, offset: 0, duration: 10, name: 'x', ...over,
});

/** A definition carrying BOTH a programme rail and a lyric slot. */
const withLyric = {
  regions: {
    right: { module: 'composer-card', side: 'left', width: '20%' },
    lyric: { module: 'script-rail' },
  },
};
/** Today's definition: no lyric slot at all. */
const withoutLyric = {
  regions: { right: { module: 'composer-card', side: 'left', width: '20%' } },
};

const payload = (definition, segments) => ({
  id: 's1',
  contentId: 'w1',
  definition,
  composer: { name: 'Handel', birthplace: 'Halle, Germany' },
  piece: { title: 'Messiah' },
  segments,
});

const RAIL = [
  seg({ n: 1, start: 10, end: 40, text: 'Comfort ye my people', name: 'Comfort ye' }),
  seg({ n: 2, start: 40, end: 130, name: 'Pifa' }),
  seg({ n: 3, start: 130, end: 160, text: 'There were shepherds', name: 'There were shepherds' }),
];
const DRY = [seg({ start: 10, end: 40, name: 'Allegro' })];

const draw = (definition, segments, position) => render(
  <SurroundFrame data={payload(definition, segments)} contentId="w1" position={position}>
    <video data-testid="player" />
  </SurroundFrame>,
);

describe('the lyric rail', () => {
  beforeEach(() => {
    resetSurroundRegistry();
    registerSurroundBuiltins();
  });

  it('shows the sung text of the sounding segment', () => {
    draw(withLyric, RAIL, 20);
    expect(screen.getByTestId('surround-script-rail-text')).toHaveTextContent('Comfort ye my people');
  });

  it('heads the text with the number’s source, not its label', () => {
    draw(withLyric, RAIL, 20);
    // Nothing in RAIL authors `heading:`, so the header falls back to the only
    // name the number has — and it carries NO numeral.
    const heading = screen.getByTestId('surround-script-rail-heading');
    expect(heading).toHaveTextContent('Comfort ye');
    expect(heading.textContent).not.toMatch(/^\s*1\./);
  });

  /**
   * `subheading:` and `heading:` reach the LEFT rail's annotation line and the
   * band's NOW register — and on a texted piece the left rail is parked off
   * screen and the band is on the far side of the video, so the one column a
   * viewer is reading never said whether this was an air or a chorus.
   *
   * TO GO RED: drop `billing` from `lyricStateAt`, or print it as a sibling of
   * the heading rather than inside it.
   */
  it('bills the number by its source and its manner', () => {
    const billed = [
      seg({
        n: 2, start: 10, end: 40, label: 'Behold, and see if there be any sorrow',
        text: 'Behold, and see if there be any sorrow\nlike unto His sorrow.',
        subheading: 'Air (Tenor)', heading: 'Lamentations 1:12',
      }),
    ];
    draw(withLyric, billed, 20);
    expect(screen.getByTestId('surround-script-rail-heading')).toHaveTextContent('Lamentations 1:12');
    expect(screen.getByTestId('surround-script-rail-subheading')).toHaveTextContent('Air (Tenor)');
    // THE LABEL IS THE INCIPIT — the first line of the text directly beneath it.
    // The rail must not print it, here or anywhere: that was one line twice.
    const rail = screen.getByTestId('surround-script-rail');
    expect(rail.querySelectorAll('*:not(.surround-script-rail__line)').length).toBeGreaterThan(0);
    expect(screen.getByTestId('surround-script-rail-heading').textContent)
      .not.toContain('Behold');
    expect(screen.queryByTestId('surround-script-rail-billing')).not.toBeInTheDocument();
  });

  it('prints no subheader for a number that authors neither field', () => {
    draw(withLyric, RAIL, 20);
    expect(screen.queryByTestId('surround-script-rail-subheading')).not.toBeInTheDocument();
  });

  it('shows the active programme branch above the current lyric', () => {
    const grouped = RAIL.map((segment, index) => ({
      ...segment,
      ancestors: [
        { index: index === 2 ? 1 : 0, kind: 'part', title: index === 2 ? 'Part Two' : 'Part One' },
        { index, kind: 'scene', title: ['Prophecy', 'Shepherds', 'Resurrection'][index] },
      ],
    }));
    draw(withLyric, grouped, 20);
    const programme = screen.getByLabelText('Current place in the work');
    expect(programme).toHaveTextContent('Part One');
    expect(programme).toHaveTextContent('Part Two');
    expect(programme).toHaveTextContent('Prophecy');
    expect(programme).toHaveTextContent('Shepherds');
    expect([...programme.querySelectorAll('[aria-current="step"]')].at(-1)).toHaveTextContent('Prophecy');
  });

  /**
   * A SCENE IS PRINTED INSIDE THE PART IT COMES FROM, not beside it. The rail
   * used to set two sibling blocks captioned PART and SCENE and leave the
   * viewer to infer the containment; the tree shows it.
   *
   * TO GO RED: render the levels as siblings again — every assertion above
   * still passes, because flat lists carry the same text.
   */
  it('prints a scene inside the part it comes from', () => {
    const grouped = RAIL.map((segment, index) => ({
      ...segment,
      ancestors: [
        { index: index === 2 ? 1 : 0, kind: 'part', title: index === 2 ? 'Part Two' : 'Part One' },
        { index, kind: 'scene', title: ['Prophecy', 'Shepherds', 'Resurrection'][index] },
      ],
    }));
    draw(withLyric, grouped, 20);
    const part = [...screen.getByLabelText('Current place in the work')
      .querySelectorAll('.surround-script-rail__programme-item')]
      .find((li) => li.querySelector('.surround-script-rail__programme-title').textContent === 'Part One');
    expect(part, 'the sounding part is not on the rail').toBeTruthy();
    expect(part).toContainElement(screen.getByText('Prophecy'));
    // ...and a CLOSED sibling opens nothing beneath it, which is what keeps a
    // five-act work from setting its whole contents page on the rail.
    const closed = [...screen.getByLabelText('Current place in the work')
      .querySelectorAll('.surround-script-rail__programme-item')]
      .find((li) => li.querySelector('.surround-script-rail__programme-title').textContent === 'Part Two');
    expect(closed.querySelector('.surround-script-rail__programme-level')).toBeNull();
  });

  // THE CONTRACT CHANGED WITH THE SLIDE, deliberately. A frame that can show
  // words mounts BOTH rails, because the programme rail cannot travel out while
  // it is being unmounted. "Never both present" became "never both PRESENTED":
  // one holds the column and the other is parked off its own edge, and which is
  // which is announced to assistive tech by `aria-hidden` rather than by
  // absence. The parking is geometry and is asserted in `band.measure`, where a
  // layout engine can see it.
  it('presents the lyric rail and hides the programme rail from the reader', () => {
    draw(withLyric, RAIL, 20);
    expect(screen.getByTestId('surround-lyric-rail')).not.toHaveAttribute('aria-hidden');
    expect(screen.getByTestId('surround-rail')).toHaveAttribute('aria-hidden', 'true');
  });

  it('marks the frame as sliding, so the rails travel rather than swap', () => {
    const { container } = draw(withLyric, RAIL, 20);
    expect(container.querySelector('.surround-frame').className).toContain('surround-frame--slides');
  });

  it('keeps the composer on screen, in the corner plate', () => {
    draw(withLyric, RAIL, 20);
    // Both rails are mounted now, so both carry a composer card. The one that
    // matters is the plate inside the LYRIC rail.
    const card = screen.getByTestId('surround-script-rail-plate')
      .querySelector('[data-testid="surround-composer-card"]');
    expect(card).toHaveAttribute('data-variant', 'plate');
    expect(card).toHaveTextContent('Handel');
  });

  it('moves the rail to the right, so the video sits flush left', () => {
    const { container } = draw(withLyric, RAIL, 20);
    const root = container.querySelector('.surround-frame');
    expect(root.className).toContain('surround-frame--lyric');
    // `--rail-left` is what puts the programme rail before the media box.
    expect(root.className).not.toContain('surround-frame--rail-left');
  });

  /**
   * AN INSTRUMENTAL NUMBER HANDS THE COLUMN BACK. A lyric rail holding no lyric
   * is a mat with nothing in it, and the Pifa runs ninety seconds — long enough
   * that the programme rail saying what is sounding is the better screen.
   *
   * TO GO RED: keep the frame in its lyric layout for a sounding segment that
   * authored no text, as every version before 574abfd69 did.
   */
  it('hands the column back to the programme on an instrumental number', () => {
    const { container } = draw(withLyric, RAIL, 125);
    expect(container.querySelector('.surround-frame').className)
      .not.toContain('surround-frame--lyric');
    expect(screen.getByTestId('surround-rail')).not.toHaveAttribute('aria-hidden');
  });

  it('hands the screen back to the programme rail on a long gap', () => {
    const { container } = draw(withLyric, RAIL, 300);
    expect(container.querySelector('.surround-frame').className).not.toContain('surround-frame--lyric');
    expect(screen.getByTestId('surround-rail')).not.toHaveAttribute('aria-hidden');
    expect(screen.getByTestId('surround-lyric-rail')).toHaveAttribute('aria-hidden', 'true');
  });

  /**
   * ...AND A SHORT SILENCE DOES NOT, which is the other half of the same rule.
   * The rails TRAVEL: sliding them out and back across the seconds between two
   * numbers is exactly the flap the grace window exists to prevent, and only
   * the LENGTH of the silence tells the two cases apart.
   *
   * 170 s is ten seconds past the last number's end — nothing sounding, inside
   * the window. 45 s used to stand here and never tested this at all: it is
   * inside the Pifa, so it passed on the instrumental rule above instead.
   *
   * TO GO RED: delete the grace branch from `lyricStateAt`, as the merge did.
   */
  it('holds through a gap shorter than the grace window', () => {
    const { container } = draw(withLyric, RAIL, 170);
    expect(container.querySelector('.surround-frame').className).toContain('surround-frame--lyric');
  });

  // DORMANT MEANS THE OLD TREE EXACTLY: one rail, no slide, no second mount.
  // A piece with no words must not pay for a rail it can never show.
  it('is dormant on a piece whose segments carry no words', () => {
    const { container } = draw(withLyric, DRY, 20);
    expect(screen.getByTestId('surround-rail')).toBeInTheDocument();
    expect(screen.queryByTestId('surround-lyric-rail')).not.toBeInTheDocument();
    expect(container.querySelector('.surround-frame').className).not.toContain('surround-frame--slides');
  });

  it('is dormant for a definition that authors no lyric slot', () => {
    draw(withoutLyric, RAIL, 20);
    expect(screen.getByTestId('surround-rail')).toBeInTheDocument();
    expect(screen.queryByTestId('surround-lyric-rail')).not.toBeInTheDocument();
    // The card is in its FULL home, not the corner plate.
    expect(screen.getByTestId('surround-composer-card')).not.toHaveAttribute('data-variant');
  });
});
