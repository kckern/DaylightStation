import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import OpponentPortrait, { opponentStatus } from './OpponentPortrait.jsx';
import { DEFAULT_ROSTER, themeForLevel, TOP_LEVEL } from '@shared-gaming/chess/ladder.mjs';

describe('the opponent status line', () => {
  it('says what they are doing, from real state only', () => {
    expect(opponentStatus({ thinking: true })).toBe('Thinking…');
    expect(opponentStatus({ lastMove: 'Nf3' })).toBe('Played Nf3');
    expect(opponentStatus({ lastMove: 'Nxe5', lastCapture: 'knight' })).toBe('Took your knight');
    expect(opponentStatus({})).toBe('Waiting for you');
  });

  it('reports the end of the game from the player\'s side', () => {
    // "Beaten" when the player won — the line is about the opponent, so it must
    // not read as though the child lost when they have just won.
    expect(opponentStatus({ gameOver: true, result: 'win' })).toBe('Beaten');
    expect(opponentStatus({ gameOver: true, result: 'loss' })).toBe('Won');
    expect(opponentStatus({ gameOver: true, result: 'draw' })).toBe('Drew with you');
  });

  it('prefers thinking over a stale last move', () => {
    // Once they are on the clock again, what they played last turn is history.
    expect(opponentStatus({ thinking: true, lastMove: 'Nf3', lastCapture: 'pawn' })).toBe('Thinking…');
  });
});

describe('the portrait', () => {
  it('shows the character and their status', () => {
    render(<OpponentPortrait opponent={DEFAULT_ROSTER[3]} level={3} status="Thinking…" />);
    expect(screen.getByText(DEFAULT_ROSTER[3].name)).toBeTruthy();
    expect(screen.getByText('Thinking…')).toBeTruthy();
  });

  it('draws an identicon when the roster ships no artwork', () => {
    const { container } = render(<OpponentPortrait opponent={DEFAULT_ROSTER[0]} level={0} />);
    expect(container.querySelector('.chess-opponent__identicon')).toBeTruthy();
    expect(container.querySelector('.chess-opponent__art')).toBeNull();
  });

  it('uses the roster artwork when there is some — the Pokemon case', () => {
    const { container } = render(
      <OpponentPortrait opponent={{ level: 2, name: 'Magikarp', art: '/magikarp.png' }} level={2} />,
    );
    expect(container.querySelector('.chess-opponent__art').getAttribute('src')).toBe('/magikarp.png');
    expect(container.querySelector('.chess-opponent__identicon')).toBeNull();
  });

  it('gives the same character the same face every time', () => {
    // The identicon is generated from the name, so a character is recognisable
    // across games — and across the other games in this house that use it.
    const first = render(<OpponentPortrait opponent={DEFAULT_ROSTER[7]} level={7} />).container.innerHTML;
    const second = render(<OpponentPortrait opponent={DEFAULT_ROSTER[7]} level={7} />).container.innerHTML;
    expect(first).toBe(second);
    const other = render(<OpponentPortrait opponent={DEFAULT_ROSTER[8]} level={8} />).container.innerHTML;
    expect(other).not.toBe(first);
  });

  it('never renders a blank where a name should be', () => {
    render(<OpponentPortrait opponent={null} level={5} />);
    expect(screen.getByText('Level 5')).toBeTruthy();
  });
});

describe('the board theme', () => {
  it('is a colour per level, deepening up the ladder', () => {
    expect(themeForLevel(0)).not.toBe(themeForLevel(TOP_LEVEL));
    expect(themeForLevel(0)).toBe(DEFAULT_ROSTER[0].theme);
  });

  it('clamps rather than producing nonsense off the ends', () => {
    expect(themeForLevel(-5)).toBe(themeForLevel(0));
    expect(themeForLevel(999)).toBe(themeForLevel(TOP_LEVEL));
  });
});
