import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { TetrisOverlay } from '../../PianoTetris/components/TetrisOverlay.jsx';
import { SideScrollerOverlay } from '../../SideScrollerGame/components/SideScrollerOverlay.jsx';
import { SpaceInvadersOverlay } from '../../PianoSpaceInvaders/components/SpaceInvadersOverlay.jsx';

const invaderScore = {
  points: 1200, misses: 2, perfects: 8, goods: 2, maxCombo: 5,
};

describe('terminal game overlays', () => {
  it('keeps Tetris game over visible with an explicit piano restart', () => {
    const { container } = render(<TetrisOverlay phase="GAME_OVER" score={1200} linesCleared={4} level={2} />);
    expect(container.querySelector('[role="status"]')).toBeTruthy();
    expect(container.textContent).toContain('Press any key to play again');
  });

  it('keeps Side Scroller game over visible with an explicit piano restart', () => {
    const { container } = render(<SideScrollerOverlay phase="GAME_OVER" score={1200} level={2} />);
    expect(container.querySelector('[role="status"]')).toBeTruthy();
    expect(container.textContent).toContain('Press any key to play again');
  });

  it('distinguishes a terminal Space Invaders failure from an automatic level retry', () => {
    const terminal = render(<SpaceInvadersOverlay gameState="LEVEL_FAILED" score={invaderScore} terminal />);
    const retry = render(<SpaceInvadersOverlay gameState="LEVEL_FAILED" score={invaderScore} />);
    expect(terminal.container.textContent).toContain('Press any key to play again');
    expect(retry.container.textContent).not.toContain('Press any key to play again');
  });

  it('keeps Space Invaders victory visible with an explicit piano restart', () => {
    const { container } = render(<SpaceInvadersOverlay gameState="VICTORY" score={invaderScore} />);
    expect(container.querySelector('[role="status"]')).toBeTruthy();
    expect(container.textContent).toContain('Press any key to play again');
  });
});

