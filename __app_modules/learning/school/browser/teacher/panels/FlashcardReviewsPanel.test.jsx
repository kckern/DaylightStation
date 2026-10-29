import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import FlashcardReviewsPanel, { faceLabel } from "./FlashcardReviewsPanel.jsx";

const api = vi.hoisted(() => ({ flashcardTeacherReport: vi.fn() }));
const profile = vi.hoisted(() => ({ current: { currentTeacher: { id: 'parent' } } }));
vi.mock("../../schoolApi.js", () => ({ schoolApi: api }));
vi.mock("../TeacherProfileContext.jsx", () => ({ useTeacherProfileOptional: () => profile.current }));

const ok = (data) => ({ ok: true, status: 200, data });
const text = (value) => ({ blocks: [{ type: 'text', text: value }] });
const REPORT = { learnerId: 'kid', decks: [
  { id: 'science/cells', title: 'Cells', sessions: [{ sessionId: 's1', startedAt: '2026-08-23T12:00:00.000Z', activeSeconds: 240, reviews: [
    { at: '2026-08-23T12:01:00.000Z', cardId: 'a', rating: 'again', mode: 'review', direction: 'front_to_back', front: text('Cell'), back: text('Unit of life') },
    { at: '2026-08-23T12:02:00.000Z', cardId: 'b', rating: 'good', mode: 'review', direction: 'back_to_front', front: text('Nucleus'), back: text('Control centre') },
  ] }] },
  { id: 'unrelated', title: 'Never touched', sessions: [] },
] };

describe('FlashcardReviewsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    profile.current = { currentTeacher: { id: 'parent' } };
    api.flashcardTeacherReport.mockResolvedValue(ok(REPORT));
  });

  it('lists reviewed decks by session, and opens a session into each card and its rating', async () => {
    render(<FlashcardReviewsPanel learnerId="kid" learnerName="Kid" />);
    const head = await screen.findByRole('button', { name: /2 cards · 4 min · 1 Again, 1 Good/ });
    expect(screen.queryByText('Never touched')).toBeNull();
    fireEvent.click(head);
    // The face shown first leads: back_to_front shows the back.
    expect(screen.getByText('Cell').closest('li')).toHaveTextContent('Again');
    expect(screen.getByText('Control centre').closest('li')).toHaveTextContent('Nucleus');
    expect(api.flashcardTeacherReport).toHaveBeenCalledWith({ learnerId: 'kid', actorId: 'parent' });
  });

  it('lists an enrolled deck before its first review, and renders nothing for a learner with no flashcards', async () => {
    const { unmount } = render(<FlashcardReviewsPanel learnerId="kid" enrolledDeckIds={['unrelated']} />);
    expect(await screen.findByText('Never touched')).toBeInTheDocument();
    expect(screen.getByText('No reviews yet.')).toBeInTheDocument();
    unmount();
    api.flashcardTeacherReport.mockResolvedValue(ok({ decks: [{ id: 'unrelated', sessions: [] }] }));
    const { container } = render(<FlashcardReviewsPanel learnerId="kid" />);
    await vi.waitFor(() => expect(api.flashcardTeacherReport).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(container.querySelector('.teacher-panel__skeleton')).toBeNull());
    expect(container).toBeEmptyDOMElement();
  });

  it('reads a face as its first readable block', () => {
    expect(faceLabel(text('Hi'))).toBe('Hi');
    expect(faceLabel({ blocks: [{ type: 'image', alt: 'A cell' }] })).toBe('A cell');
    expect(faceLabel({ blocks: [{ type: 'image' }] })).toBe('(image)');
    expect(faceLabel(null)).toBeNull();
  });
});
