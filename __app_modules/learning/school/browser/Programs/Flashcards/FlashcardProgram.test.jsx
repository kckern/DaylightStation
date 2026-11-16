import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import FlashcardProgram from "./FlashcardProgram.jsx";

const deck = {
  id: 'biology/cells', title: 'Cell organelles', cards: [{
    cardId: 'mitochondrion',
    front: { blocks: [{ type: 'text', text: 'Where is ATP made?' }, { type: 'image', assetId: 'mito.png', alt: 'Mitochondrion' }] },
    back: { blocks: [{ type: 'text', text: 'Mitochondrion' }, { type: 'audio', assetId: 'mito.mp3', transcript: 'Mitochondrion' }] },
  }],
};

beforeEach(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); });

describe('FlashcardProgram', () => {
  it('requires a recorded session before showing tracked review controls and offers retry after failed open', async () => {
    const onEvent = vi.fn().mockResolvedValue({ ok: true });
    const studyApi = { open: vi.fn().mockResolvedValue({ ok: false, status: 503, data: null }), review: vi.fn() };
    render(<FlashcardProgram descriptor={{ deck, userId: 'kid', policy: { modes: ['review'] } }} studyApi={studyApi} onEvent={onEvent} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not open');
    expect(screen.queryByRole('button', { name: 'Show answer' })).not.toBeInTheDocument();
    expect(screen.queryByText('Review complete')).not.toBeInTheDocument();
    studyApi.open.mockResolvedValueOnce({ ok: true, data: { session: { sessionId: 'retry', reviews: 0, cardIds: ['mitochondrion'] } } });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Show answer' })).toBeInTheDocument();
    expect(onEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'review' }));
  });

  it('keeps an unrecorded card and accepts one pending rating at a time', async () => {
    let settle;
    const studyApi = {
      open: vi.fn().mockResolvedValue({ ok: true, data: { session: { sessionId: 's1', reviews: 0, cardIds: ['mitochondrion'] } } }),
      review: vi.fn(() => new Promise(resolve => { settle = resolve; })),
    };
    render(<FlashcardProgram descriptor={{ deck, userId: 'kid', policy: { modes: ['review'] } }} studyApi={studyApi} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show answer' }));
    const rate = screen.getByRole('button', { name: 'good' });
    fireEvent.click(rate); fireEvent.click(rate);
    expect(studyApi.review).toHaveBeenCalledTimes(1);
    settle({ ok: false, status: 503 });
    expect(await screen.findByRole('alert')).toHaveTextContent('not saved');
    expect(screen.queryByText('Review complete')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'good' })).toBeEnabled();
  });
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


const reviewDeck = () => ({ id: 'two-cards', title: 'Two cards', cards: ['A', 'B'].map(cardId => ({
  cardId, front: { blocks: [{ type: 'text', text: cardId }] }, back: { blocks: [{ type: 'text', text: `${cardId} back` }] },
})) });

it('locks mode navigation during a pending rating and retains B after A is acknowledged', async () => {
  const twoCards = reviewDeck(); let acknowledge;
  const studyApi = {
    open: vi.fn().mockResolvedValue({ ok: true, data: { session: { sessionId: 'two', cardIds: ['A', 'B'] } } }),
    review: vi.fn(() => new Promise(resolve => { acknowledge = resolve; })),
  };
  render(<FlashcardProgram descriptor={{ deck: twoCards, userId: 'kid', policy: { modes: ['review', 'cards'] } }} studyApi={studyApi} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Show answer' }));
  fireEvent.click(screen.getByRole('button', { name: 'good' }));
  expect(screen.getByRole('button', { name: 'cards' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'review' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Leave for now' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'cards' }));
  expect(screen.getByText('A back')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
  await act(async () => { acknowledge({ ok: true }); });
  expect(screen.getByText('B')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'cards' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  fireEvent.click(screen.getByRole('button', { name: 'review' }));
  expect(screen.getByText('B')).toBeInTheDocument();
  expect(screen.queryByText('A')).not.toBeInTheDocument();
  expect(studyApi.review).toHaveBeenCalledTimes(1);
});

it('locks Learn direction and answer controls while its formative review is pending', async () => {
  let acknowledge;
  const onEvent = vi.fn(() => new Promise(resolve => { acknowledge = resolve; }));
  render(<FlashcardProgram descriptor={{ deck: reviewDeck(), policy: { modes: ['learn', 'cards'] } }} onEvent={onEvent} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A back' } });
  fireEvent.click(screen.getByRole('button', { name: 'Check answer' }));
  expect(screen.getByRole('button', { name: 'Study other direction' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Check answer' })).toBeDisabled();
  expect(screen.getByRole('textbox')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Leave for now' })).toBeEnabled();
  await act(async () => { acknowledge({ ok: true }); });
  expect(screen.getByText('B')).toBeInTheDocument();
});

it.each(['good', 'again'])('applies %s to the exact rated card even if the caller reorders the queue during its save', async rating => {
  const twoCards = reviewDeck(); const descriptor = { deck: twoCards, policy: { modes: ['review'] } };
  let acknowledge;
  const onEvent = vi.fn(event => event.type === 'review' ? new Promise(resolve => { acknowledge = resolve; }) : Promise.resolve({ ok: true }));
  const view = render(<FlashcardProgram descriptor={descriptor} onEvent={onEvent} />);
  fireEvent.click(screen.getByRole('button', { name: 'Show answer' }));
  fireEvent.click(screen.getByRole('button', { name: rating }));
  act(() => { twoCards.cards.reverse(); view.rerender(<FlashcardProgram descriptor={descriptor} onEvent={onEvent} />); });
  await act(async () => { acknowledge({ ok: true }); });
  expect(screen.getByText('B')).toBeInTheDocument();
  expect(screen.getByText(rating === 'again' ? /1 of 2/ : /1 of 1/)).toBeInTheDocument();
  if (rating === 'again') {
    fireEvent.click(screen.getByRole('button', { name: 'Show answer' }));
    fireEvent.click(screen.getByRole('button', { name: 'good' }));
    await act(async () => { acknowledge({ ok: true }); });
    expect(screen.getByText('A')).toBeInTheDocument();
  }
});
