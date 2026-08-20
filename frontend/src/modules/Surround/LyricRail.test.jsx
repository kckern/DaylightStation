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

  it('takes the programme rail away — the two are never both present', () => {
    draw(withLyric, RAIL, 20);
    expect(screen.getByTestId('surround-lyric-rail')).toBeInTheDocument();
    expect(screen.queryByTestId('surround-rail')).not.toBeInTheDocument();
    expect(screen.queryByTestId('surround-composer-fact-zone')).not.toBeInTheDocument();
  });

  it('keeps the composer on screen, in the corner plate', () => {
    draw(withLyric, RAIL, 20);
    const card = screen.getByTestId('surround-composer-card');
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
    draw(withLyric, RAIL, 300);
    expect(screen.getByTestId('surround-rail')).toBeInTheDocument();
    expect(screen.queryByTestId('surround-lyric-rail')).not.toBeInTheDocument();
  });

  it('holds through a gap shorter than the grace window', () => {
    draw(withLyric, RAIL, 45);
    expect(screen.getByTestId('surround-lyric-rail')).toBeInTheDocument();
  });

  it('is dormant on a piece whose segments carry no words', () => {
    draw(withLyric, DRY, 20);
    expect(screen.getByTestId('surround-rail')).toBeInTheDocument();
    expect(screen.queryByTestId('surround-lyric-rail')).not.toBeInTheDocument();
  });

  it('is dormant for a definition that authors no lyric slot', () => {
    draw(withoutLyric, RAIL, 20);
    expect(screen.getByTestId('surround-rail')).toBeInTheDocument();
    expect(screen.queryByTestId('surround-lyric-rail')).not.toBeInTheDocument();
    // The card is in its FULL home, not the corner plate.
    expect(screen.getByTestId('surround-composer-card')).not.toHaveAttribute('data-variant');
  });
});
