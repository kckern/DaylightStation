import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RoundStanding } from './RoundStanding.jsx';

const standing = (over = {}) => ({
  round: 2, level: 1, counted: 2, practice: 4,
  gateWins: 2, gateNeeded: 5, gateWindow: 7, remaining: 3,
  promotes: false, atTop: false, ...over,
});

describe('RoundStanding', () => {
  it('draws every win the child remembers, not just the ones that counted', () => {
    const { container } = render(
      <RoundStanding standing={standing()} opponentName="Weedle" nextName="Rattata" />,
    );
    // Six markers: "I beat him six times" is answerable with yes.
    const markers = container.querySelectorAll('.chess-round__marker:not(.chess-round__marker--none)');
    expect(markers).toHaveLength(6);
    expect(container.querySelectorAll('.chess-round__row--counted .chess-round__marker')).toHaveLength(2);
    expect(container.querySelectorAll('.chess-round__row--practice .chess-round__marker')).toHaveLength(4);
  });

  it('states the round, the opponent, and what is left', () => {
    render(<RoundStanding standing={standing()} opponentName="Weedle" nextName="Rattata" />);
    expect(screen.getByText('Round 2 — Weedle')).toBeTruthy();
    expect(screen.getByText(/3 more wins on your own and you're through to Rattata/)).toBeTruthy();
  });

  it('never uses the word unlock anywhere on the panel', () => {
    const { container } = render(
      <RoundStanding standing={standing()} opponentName="Weedle" nextName="Rattata" />,
    );
    expect(container.textContent).not.toMatch(/unlock/i);
  });

  it('shows an empty Match wins row rather than hiding the thing to aim at', () => {
    const { container } = render(<RoundStanding standing={standing({ counted: 0, practice: 0 })} />);
    expect(container.querySelectorAll('.chess-round__marker--none').length).toBeGreaterThan(0);
  });

  it('renders nothing at all without a standing, rather than an empty frame', () => {
    const { container } = render(<RoundStanding standing={null} />);
    expect(container.innerHTML).toBe('');
  });
});
