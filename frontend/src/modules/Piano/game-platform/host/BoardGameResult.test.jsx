import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import BoardGameResult from './BoardGameResult.jsx';
import BoardGameOpening from './BoardGameOpening.jsx';
import OpponentRosterSheet from '../opponent/OpponentRosterSheet.jsx';

describe('shared board-game ceremonies', () => {
  it.each([['win', 'You win'], ['loss', 'You lose'], ['draw', 'Draw']])('renders the %s result state', (result, headline) => {
    const onPlayAgain = vi.fn();
    const { getByText, getByRole } = render(
      <BoardGameResult result={result} opponent={{ name: 'Pip' }} promoted metrics={{ Moves: 12 }} onPlayAgain={onPlayAgain} />,
    );
    expect(getByText(headline)).toBeTruthy();
    expect(getByText('New opponent unlocked')).toBeTruthy();
    expect(getByText('12')).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'Play again' }));
    expect(onPlayAgain).toHaveBeenCalledOnce();
  });

  it('announces the opening turn and renders a 21-rung roster with one current opponent', () => {
    const roster = Array.from({ length: 21 }, (_, index) => ({ id: `p${index}`, name: `Opponent ${index + 1}`, position: index + 1 }));
    const { getByText, container } = render(<><BoardGameOpening opponent={roster[3]} turnLabel="They open" /><OpponentRosterSheet roster={roster} position={4} onClose={() => {}} /></>);
    expect(getByText('You versus Opponent 4')).toBeTruthy();
    expect(getByText('They open')).toBeTruthy();
    expect(container.querySelectorAll('.pg-roster__row')).toHaveLength(21);
    expect(container.querySelectorAll('.pg-roster__row--current')).toHaveLength(1);
  });

  it('lists standing notes, and renders no list without them', () => {
    const { getByText, container, rerender } = render(
      <BoardGameResult result="win" opponent={{ name: 'Pip' }} notes={['You vs Pip: 3 wins, 0 losses']} onPlayAgain={() => {}} />,
    );
    expect(getByText('You vs Pip: 3 wins, 0 losses')).toBeTruthy();
    rerender(<BoardGameResult result="win" opponent={{ name: 'Pip' }} onPlayAgain={() => {}} />);
    expect(container.querySelector('.pg-result__notes')).toBe(null);
  });
});
