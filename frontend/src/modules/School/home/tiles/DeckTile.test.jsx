import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import DeckTile from './DeckTile.jsx';

const item = { id: 'b1', title: 'US States', itemCount: 50, bestAccuracy: 88 };

describe('DeckTile', () => {
  it('renders the title and "N items"', () => {
    render(<DeckTile item={item} onOpen={() => {}} />);
    expect(screen.getByText('US States')).toBeTruthy();
    expect(screen.getByText(/50 items/)).toBeTruthy();
  });

  it('clicking Quiz calls onOpen(item, "quiz")', () => {
    const onOpen = vi.fn(() => Promise.resolve());
    render(<DeckTile item={item} onOpen={onOpen} />);
    fireEvent.click(screen.getByText('Quiz'));
    expect(onOpen).toHaveBeenCalledWith(item, 'quiz');
  });

  it('clicking Cards calls onOpen(item, "flashcard")', () => {
    const onOpen = vi.fn(() => Promise.resolve());
    render(<DeckTile item={item} onOpen={onOpen} />);
    fireEvent.click(screen.getByText('Cards'));
    expect(onOpen).toHaveBeenCalledWith(item, 'flashcard');
  });

  it('a double-tap fires onOpen only once while the launch is in flight', () => {
    const onOpen = vi.fn(() => new Promise(() => {})); // never resolves
    render(<DeckTile item={item} onOpen={onOpen} />);
    const quizButton = screen.getByText('Quiz');
    fireEvent.click(quizButton);
    fireEvent.click(quizButton);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
