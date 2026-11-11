import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChessResult } from './ChessResult.jsx';

describe('ChessResult', () => {
  it('shows the head-to-head record, why a win did not count, and the climb', () => {
    const { getByText } = render(
      <ChessResult
        result="win"
        outcome="checkmate"
        opponent={{ name: 'Weedle' }}
        level={1}
        record={{ moves: 31, help: { hints: 11, best_moves: 14, takebacks: 1 } }}
        ladder={{
          persisted: true, promoted: false, counted: false,
          not_counted: { reason: 'best_moves', used: 14, allowed: 0 },
          up_next: { level: 2, name: 'Kakuna' },
          status: { wins: 2, needed: 5, at_top: false },
          head_to_head: { opponent: { id: 'pokemon:level-2', name: 'Weedle' }, win: 6, loss: 0, draw: 0 },
        }}
        onPlayAgain={vi.fn()}
      />,
    );
    expect(getByText('You vs Weedle: 6 wins, 0 losses')).toBeTruthy();
    expect(getByText("This win didn't count toward Kakuna: 14 best-move requests, 0 allowed.")).toBeTruthy();
    expect(getByText('2 of 5 wins toward Kakuna')).toBeTruthy();
  });

  it.each([
    ['stalemate', 'Draw — stalemate'],
    ['insufficient_material', 'Draw — not enough pieces'],
    ['fifty_move_rule', 'Draw — 50-move rule'],
    ['threefold_repetition', 'Draw — same position 3 times'],
  ])('a draw by %s says why in its headline', (outcome, headline) => {
    const { container } = render(
      <ChessResult result="draw" outcome={outcome} opponent={{ name: 'Weedle' }} level={1} record={null} onPlayAgain={vi.fn()} />,
    );
    expect(container.querySelector('.chess-result__headline').textContent).toBe(headline);
  });

  it('offers New game, and Done only when the host can take the player back', () => {
    const onPlayAgain = vi.fn();
    const onDone = vi.fn();
    const withDone = render(
      <ChessResult result="draw" outcome="stalemate" opponent={null} level={1} record={null} onPlayAgain={onPlayAgain} onDone={onDone} />,
    );
    fireEvent.click(withDone.getByRole('button', { name: 'New game' }));
    fireEvent.click(withDone.getByRole('button', { name: 'Done' }));
    expect(onPlayAgain).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    withDone.unmount();

    const withoutDone = render(
      <ChessResult result="win" outcome="checkmate" opponent={null} level={1} record={null} onPlayAgain={onPlayAgain} />,
    );
    expect(withoutDone.queryByRole('button', { name: 'Done' })).toBeNull();
    expect(withoutDone.container.querySelector('.chess-result__headline').textContent).toBe('You win');
  });
});
