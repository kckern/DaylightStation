import { render } from '@testing-library/react';
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
});
