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
    lyric: { module: 'libretto' },
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
    expect(screen.getByTestId('surround-libretto-text')).toHaveTextContent('Comfort ye my people');
  });

  it('heads the text with the segment numeral and name', () => {
    draw(withLyric, RAIL, 20);
    expect(screen.getByTestId('surround-libretto-heading')).toHaveTextContent('1. Comfort ye');
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
    const card = screen.getByTestId('surround-libretto-plate')
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

  it('stays up through an instrumental number, and prints no text box', () => {
    draw(withLyric, RAIL, 125);
    expect(screen.getByTestId('surround-lyric-rail')).toBeInTheDocument();
    expect(screen.queryByTestId('surround-libretto-text')).not.toBeInTheDocument();
    expect(screen.getByTestId('surround-libretto-heading')).toHaveTextContent('2. Pifa');
  });

  it('hands the screen back to the programme rail on a long gap', () => {
    const { container } = draw(withLyric, RAIL, 300);
    expect(container.querySelector('.surround-frame').className).not.toContain('surround-frame--lyric');
    expect(screen.getByTestId('surround-rail')).not.toHaveAttribute('aria-hidden');
    expect(screen.getByTestId('surround-lyric-rail')).toHaveAttribute('aria-hidden', 'true');
  });

  it('holds through a gap shorter than the grace window', () => {
    const { container } = draw(withLyric, RAIL, 45);
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
