/**
 * WordsView — one `CardLadderWordsPanel` per card-ladder enrollment
 * (task-5-brief.md). Enrollments come from the same `programs` array
 * `AssignmentsView` edits: `{programId: 'flashcards', deckId, title,
 * policy: {mode: 'card-ladder'}}`.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WordsView } from "./WorkspaceViews.jsx";

vi.mock("../schoolApi.js", () => ({ schoolApi: { assignments: vi.fn() } }));
vi.mock("./panels/CardLadderWordsPanel.jsx", () => ({
  __esModule: true,
  default: ({ deckId, title, deckTitles = {} }) => (
    <div data-testid="card-ladder-panel" data-deck-titles={JSON.stringify(deckTitles)}>{title ?? deckId}</div>
  ),
  cardLadderEnrollments: (programs) => (Array.isArray(programs) ? programs : [])
    .filter((entry) => entry?.programId === 'flashcards' && entry?.policy?.mode === 'card-ladder' && entry?.deckId),
}));

import { schoolApi } from "../schoolApi.js";

const ok = (data) => ({ ok: true, status: 200, data });

beforeEach(() => { vi.clearAllMocks(); });

it('renders one panel per card-ladder enrollment, ignoring unrelated programs', async () => {
  schoolApi.assignments.mockResolvedValue(ok({
    programs: [
      { programId: 'flashcards', deckId: 'language/korean/week-01-classroom', title: 'Week 1 · Classroom', policy: { mode: 'card-ladder' } },
      { programId: 'flashcards', deckId: 'spanish-colors', title: 'Colors', policy: { mode: 'ordinary' } },
      { programId: 'story-time', title: 'Story time' },
    ],
  }));
  render(<WordsView learnerId="learner_a" learnerName="learner_a" />);
  expect(await screen.findByText('Week 1 · Classroom')).toBeTruthy();
  expect(screen.queryByText('Colors')).toBeNull();
  expect(screen.getAllByTestId('card-ladder-panel')).toHaveLength(1);
});

it('names the empty state when there is no card-ladder enrollment', async () => {
  schoolApi.assignments.mockResolvedValue(ok({ programs: [] }));
  render(<WordsView learnerId="learner_a" learnerName="learner_a" />);
  expect(await screen.findByText(/not enrolled in a card-ladder deck/)).toBeTruthy();
});

it('hands every panel the titles of all the learner\'s card-ladder decks, for its new-word pool', async () => {
  schoolApi.assignments.mockResolvedValue(ok({
    programs: [
      { programId: 'flashcards', deckId: 'deck-one', title: 'Deck One', policy: { mode: 'card-ladder' } },
      { programId: 'flashcards', deckId: 'deck-two', title: 'Deck Two', policy: { mode: 'card-ladder' } },
    ],
  }));
  render(<WordsView learnerId="learner_a" learnerName="learner_a" />);
  await screen.findByText('Deck One');
  for (const panel of screen.getAllByTestId('card-ladder-panel')) {
    expect(JSON.parse(panel.dataset.deckTitles)).toEqual({ 'deck-one': 'Deck One', 'deck-two': 'Deck Two' });
  }
});
