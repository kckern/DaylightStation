import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import FlashcardProgram from './FlashcardProgram.jsx';

const deck = {
  id: 'biology/cells', title: 'Cell organelles', cards: [{
    cardId: 'mitochondrion',
    front: { blocks: [{ type: 'text', text: 'Where is ATP made?' }, { type: 'image', assetId: 'mito.png', alt: 'Mitochondrion' }] },
    back: { blocks: [{ type: 'text', text: 'Mitochondrion' }, { type: 'audio', assetId: 'mito.mp3', transcript: 'Mitochondrion' }] },
  }],
};

beforeEach(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); });

describe('FlashcardProgram', () => {
  it('renders accessible rich card media and lets a learner flip it', () => {
    render(<FlashcardProgram descriptor={{ deck, policy: { modes: ['cards'] } }} resolveAssetUrl={(id) => `/media/${id}`} />);
    expect(screen.getByText('Where is ATP made?')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Mitochondrion' })).toHaveAttribute('src', '/media/mito.png');
    fireEvent.click(screen.getByRole('button', { name: 'Show answer' }));
    expect(screen.getAllByText('Mitochondrion').length).toBeGreaterThan(0);
    expect(screen.getByText('Transcript')).toBeInTheDocument();
  });
  it('persists a confidence rating before moving past a review card', async () => {
    const review = vi.fn().mockResolvedValue({ ok: true });
    const studyApi = {
      open: vi.fn().mockResolvedValue({ ok: true, data: { session: { sessionId: 's1', reviews: 0, cardIds: ['mitochondrion'] } } }),
      review, heartbeat: vi.fn(), summary: vi.fn().mockResolvedValue({ ok: true, data: { counts: { due: 2, new: 3, mastered: 4 } } }),
    };
    render(<FlashcardProgram descriptor={{ deck, userId: 'kid', policy: { modes: ['review'] } }} studyApi={studyApi} />);
    await screen.findByRole('button', { name: 'Show answer' });
    expect(await screen.findByLabelText('Deck progress')).toHaveTextContent('2 due · 3 new · 4 mastered');
    fireEvent.click(screen.getByRole('button', { name: 'Show answer' }));
    fireEvent.click(screen.getByRole('button', { name: 'good' }));
    expect(review).toHaveBeenCalledWith('s1', expect.objectContaining({ cardId: 'mitochondrion', rating: 'good', mode: 'review' }));
    expect(await screen.findByText('Review complete')).toBeInTheDocument();
  });
  it('uses typed recall in Learn and records a formative confidence result', async () => {
    const onEvent = vi.fn().mockResolvedValue({ ok: true });
    render(<FlashcardProgram descriptor={{ deck, policy: { modes: ['learn'] } }} onEvent={onEvent} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'mitochondrion' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check answer' }));
    expect(await screen.findByText('Review complete')).toBeInTheDocument();
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'review', rating: 'good', mode: 'learn' }));
  });
  it('learns a neutral association without consulting assessment bank items', async () => {
    const onEvent = vi.fn().mockResolvedValue({ ok: true });
    const pairs = { ...deck, cards: [{ cardId: 'washington-olympia', front: { blocks: [{ type: 'text', text: 'Washington' }] }, back: { blocks: [{ type: 'text', text: 'Olympia' }] } }] };
    render(<FlashcardProgram descriptor={{ deck: pairs, bank: { id: 'unrelated', items: [{ id: 'different', prompt: 'Different question', answer: 'Wrong answer' }] }, policy: { modes: ['learn'] } }} onEvent={onEvent} />);
    expect(screen.getByText('Washington')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Olympia' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check answer' }));
    expect(await screen.findByText('Review complete')).toBeInTheDocument();
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ cardId: 'washington-olympia', rating: 'good' }));
  });
  it('hands an author-selected Test plan to the graded runner host', () => {
    const onEvent = vi.fn();
    const bank = { id: 'cells-check', items: [{ id: 'q1', type: 'multiple_choice' }, { id: 'q2', type: 'matching' }] };
    render(<FlashcardProgram descriptor={{ deck, bank, policy: { modes: ['test'] } }} onEvent={onEvent} />);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start graded test' }));
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'start_test', testPlan: { count: 1, types: ['multiple_choice', 'matching'] } }));
  });
});
