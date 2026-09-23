/**
 * WordsView — one `WordLadderWordsPanel` per word-ladder enrollment
 * (task-5-brief.md). Enrollments come from the same `programs` array
 * `AssignmentsView` edits: `{programId: 'flashcards', deckId, title,
 * policy: {mode: 'word-ladder'}}`.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WordsView } from './WorkspaceViews.jsx';

vi.mock('../schoolApi.js', () => ({ schoolApi: { assignments: vi.fn() } }));
vi.mock('./panels/WordLadderWordsPanel.jsx', () => ({
  __esModule: true,
  default: ({ deckId, title }) => <div data-testid="word-ladder-panel">{title ?? deckId}</div>,
  wordLadderEnrollments: (programs) => (Array.isArray(programs) ? programs : [])
    .filter((entry) => entry?.programId === 'flashcards' && entry?.policy?.mode === 'word-ladder' && entry?.deckId),
}));

import { schoolApi } from '../schoolApi.js';

const ok = (data) => ({ ok: true, status: 200, data });

beforeEach(() => { vi.clearAllMocks(); });

it('renders one panel per word-ladder enrollment, ignoring unrelated programs', async () => {
  schoolApi.assignments.mockResolvedValue(ok({
    programs: [
      { programId: 'flashcards', deckId: 'language/korean/week-01-classroom', title: 'Week 1 · Classroom', policy: { mode: 'word-ladder' } },
      { programId: 'flashcards', deckId: 'spanish-colors', title: 'Colors', policy: { mode: 'ordinary' } },
      { programId: 'story-time', title: 'Story time' },
    ],
  }));
  render(<WordsView learnerId="learner_a" learnerName="learner_a" />);
  expect(await screen.findByText('Week 1 · Classroom')).toBeTruthy();
  expect(screen.queryByText('Colors')).toBeNull();
  expect(screen.getAllByTestId('word-ladder-panel')).toHaveLength(1);
});

it('names the empty state when there is no word-ladder enrollment', async () => {
  schoolApi.assignments.mockResolvedValue(ok({ programs: [] }));
  render(<WordsView learnerId="learner_a" learnerName="learner_a" />);
  expect(await screen.findByText(/not enrolled in a word-ladder deck/)).toBeTruthy();
});
