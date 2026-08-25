import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import FlashcardDeckBrowser from './FlashcardDeckBrowser.jsx';

const decks = vi.fn();
vi.mock('../../schoolApi.js', () => ({ schoolApi: { flashcardDecks: () => decks() } }));

beforeEach(() => decks.mockReset().mockResolvedValue({ ok: true, data: { decks: [
  { id: 'biology/cells', title: 'Cell organelles', cardCount: 12, description: 'Cell vocabulary' },
] } }));

describe('FlashcardDeckBrowser', () => {
  it('shows published deck metadata and launches the selected deck once', async () => {
    const onLaunch = vi.fn().mockResolvedValue(true);
    render(<FlashcardDeckBrowser onLaunch={onLaunch} />);
    expect(await screen.findByText('Cell organelles')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Study' }));
    expect(onLaunch).toHaveBeenCalledWith(expect.objectContaining({ id: 'biology/cells', cardCount: 12 }));
  });
  it('names a failed catalogue fetch rather than showing an empty shelf', async () => {
    decks.mockResolvedValue({ ok: false, data: null });
    render(<FlashcardDeckBrowser onLaunch={() => {}} />);
    expect(await screen.findByText(/wouldn’t load/i)).toBeInTheDocument();
  });
});
