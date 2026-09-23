/**
 * WordLadderWordsPanel — the teacher console's per-deck word table
 * (task-5-brief.md, `docs/reference/school/word-ladder.md` "Grown-up word
 * controls"). Renders `GET /word-ladder/admin/words`, and offers Reset, Mark
 * mastered, Exclude/Include, Re-grade, and Drop deck through
 * `wordLadderAdminApi` — never `teacherWorkspaceApi` or `schoolApi`, which
 * are mounted at different bases.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import WordLadderWordsPanel from './WordLadderWordsPanel.jsx';

vi.mock('../wordLadderAdminApi.js', () => ({
  wordLadderAdminApi: {
    words: vi.fn(),
    reset: vi.fn(),
    markMastered: vi.fn(),
    exclude: vi.fn(),
    dropDeck: vi.fn(),
    regrade: vi.fn(),
  },
}));
vi.mock('../TeacherProfileContext.jsx', () => ({
  useTeacherProfileOptional: () => ({ currentTeacher: { id: 'teacher_1' } }),
  useTeacherProfile: () => ({
    currentTeacher: { id: 'teacher_1', name: 'teacher_1' },
    openPicker: vi.fn(),
    pickerOpen: false,
    requestAuthorization: vi.fn(async () => ({ ok: true, grantToken: null })),
    invalidateAuthorization: vi.fn(),
  }),
}));

import { wordLadderAdminApi } from '../wordLadderAdminApi.js';

const ok = (data) => ({ ok: true, status: 200, data });

const payload = (over = {}) => ({
  learnerId: 'learner_a', package: 'korean-vocab',
  decksSeen: ['language/korean/week-01-classroom', 'language/korean/week-02-food'],
  droppableDecks: ['language/korean/week-02-food'],
  words: [
    {
      wordId: 'word_1', term: '사과', gloss: 'apple', state: 'learning', stage: 2,
      dueDay: '2026-09-20', missStreak: 1, tricky: false, excluded: false, lastGraded: '2026-09-18',
      recentTyped: [
        { day: '2026-09-18', itemId: 'item_1', typed: 'sagwa', score: 10, judge: 'exact', reason: null, correct: true, source: 'typed', regraded: null },
      ],
    },
    {
      wordId: 'word_2', term: '배', gloss: 'pear', state: 'mastered', stage: 4,
      dueDay: '2026-10-01', missStreak: 0, tricky: true, excluded: true, lastGraded: '2026-09-10', recentTyped: [],
    },
  ],
  ...over,
});

// jsdom does not implement window.confirm; define it per-test like
// StepMatCard.test.jsx does, and remove it again afterward.
const stubConfirm = (returnValue) => {
  const confirmMock = vi.fn(() => returnValue);
  Object.defineProperty(window, 'confirm', { configurable: true, value: confirmMock });
  return confirmMock;
};

const mount = (props = {}) => render(
  <WordLadderWordsPanel learnerId="learner_a" deckId="language/korean/week-01-classroom" title="Week 1 · Classroom" {...props} />,
);

beforeEach(() => {
  vi.clearAllMocks();
  wordLadderAdminApi.words.mockResolvedValue(ok(payload()));
});

describe('rendering the word table', () => {
  it('renders one row per word from the fetch, with term, gloss, state and stage', async () => {
    mount();
    expect(await screen.findByText('사과')).toBeTruthy();
    expect(screen.getByText('apple')).toBeTruthy();
    expect(screen.getByText('배')).toBeTruthy();
    expect(screen.getByText('pear')).toBeTruthy();
    expect(wordLadderAdminApi.words).toHaveBeenCalledWith('learner_a', 'language/korean/week-01-classroom');
  });

  it('an excluded word shows Include, not Exclude', async () => {
    mount();
    await screen.findByText('배');
    const row = screen.getByText('배').closest('tr');
    expect(within(row).getByRole('button', { name: 'Include' })).toBeTruthy();
    expect(within(row).queryByRole('button', { name: 'Exclude' })).toBeNull();
  });

  it('a word that is not excluded shows Exclude, not Include', async () => {
    mount();
    await screen.findByText('사과');
    const row = screen.getByText('사과').closest('tr');
    expect(within(row).getByRole('button', { name: 'Exclude' })).toBeTruthy();
    expect(within(row).queryByRole('button', { name: 'Include' })).toBeNull();
  });
});

describe('Reset', () => {
  it('calls the write with learnerId, deckId and wordId', async () => {
    wordLadderAdminApi.reset.mockResolvedValue(ok({ learnerId: 'learner_a', package: 'korean-vocab', wordId: 'word_1', word: {} }));
    mount();
    const row = (await screen.findByText('사과')).closest('tr');
    fireEvent.click(within(row).getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(wordLadderAdminApi.reset).toHaveBeenCalledWith(
      expect.objectContaining({ learnerId: 'learner_a', deckId: 'language/korean/week-01-classroom', wordId: 'word_1' }),
    ));
    // The table re-reads after a save, rather than guessing what the reset did.
    await waitFor(() => expect(wordLadderAdminApi.words).toHaveBeenCalledTimes(2));
  });
});

describe('Mark mastered', () => {
  it('sends the picked stage', async () => {
    wordLadderAdminApi.markMastered.mockResolvedValue(ok({ learnerId: 'learner_a', wordId: 'word_1', word: {} }));
    mount();
    const row = (await screen.findByText('사과')).closest('tr');
    fireEvent.change(within(row).getByLabelText('Mastered stage'), { target: { value: '3' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Mark mastered' }));
    await waitFor(() => expect(wordLadderAdminApi.markMastered).toHaveBeenCalledWith(
      expect.objectContaining({ learnerId: 'learner_a', deckId: 'language/korean/week-01-classroom', wordId: 'word_1', stage: 3 }),
    ));
  });
});

describe('Exclude / Include', () => {
  it('excluding sends excluded: true', async () => {
    wordLadderAdminApi.exclude.mockResolvedValue(ok({ learnerId: 'learner_a', wordId: 'word_1', word: {} }));
    mount();
    const row = (await screen.findByText('사과')).closest('tr');
    fireEvent.click(within(row).getByRole('button', { name: 'Exclude' }));
    await waitFor(() => expect(wordLadderAdminApi.exclude).toHaveBeenCalledWith(
      expect.objectContaining({ learnerId: 'learner_a', deckId: 'language/korean/week-01-classroom', wordId: 'word_1', excluded: true }),
    ));
  });

  it('including sends excluded: false', async () => {
    wordLadderAdminApi.exclude.mockResolvedValue(ok({ learnerId: 'learner_a', wordId: 'word_2', word: {} }));
    mount();
    const row = (await screen.findByText('배')).closest('tr');
    fireEvent.click(within(row).getByRole('button', { name: 'Include' }));
    await waitFor(() => expect(wordLadderAdminApi.exclude).toHaveBeenCalledWith(
      expect.objectContaining({ learnerId: 'learner_a', deckId: 'language/korean/week-01-classroom', wordId: 'word_2', excluded: false }),
    ));
  });
});

describe('Re-grade', () => {
  it('Pass sends { day, itemId, pass: true } with no confirmation', async () => {
    const confirmSpy = stubConfirm(true);
    wordLadderAdminApi.regrade.mockResolvedValue(ok({ learnerId: 'learner_a', wordId: 'word_1', day: '2026-09-18', itemId: 'item_1', regraded: {} }));
    mount();
    const row = (await screen.findByText('사과')).closest('tr');
    fireEvent.click(within(row).getByRole('button', { name: /sagwa/ }));
    fireEvent.click(within(row).getByRole('button', { name: 'Pass' }));
    await waitFor(() => expect(wordLadderAdminApi.regrade).toHaveBeenCalledWith(
      expect.objectContaining({
        learnerId: 'learner_a', deckId: 'language/korean/week-01-classroom', day: '2026-09-18', itemId: 'item_1', pass: true,
      }),
    ));
    // Passing an already-exact answer changes nothing the cache disagrees
    // with — only a FAIL on an exact match risks poisoning every learner's
    // judgement cache, so only Fail asks first.
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("Fail on an exact-judged answer asks first — the judgement cache is shared across every learner in the package", async () => {
    const confirmSpy = stubConfirm(true);
    wordLadderAdminApi.regrade.mockResolvedValue(ok({ learnerId: 'learner_a', wordId: 'word_1', day: '2026-09-18', itemId: 'item_1', regraded: {} }));
    mount();
    const row = (await screen.findByText('사과')).closest('tr');
    fireEvent.click(within(row).getByRole('button', { name: /sagwa/ }));
    fireEvent.click(within(row).getByRole('button', { name: 'Fail' }));
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => expect(wordLadderAdminApi.regrade).toHaveBeenCalledWith(
      expect.objectContaining({ day: '2026-09-18', itemId: 'item_1', pass: false }),
    ));
  });

  it('declining the confirmation never calls the write', async () => {
    stubConfirm(false);
    mount();
    const row = (await screen.findByText('사과')).closest('tr');
    fireEvent.click(within(row).getByRole('button', { name: /sagwa/ }));
    fireEvent.click(within(row).getByRole('button', { name: 'Fail' }));
    expect(wordLadderAdminApi.regrade).not.toHaveBeenCalled();
  });

  it('Fail on a non-exact judge (e.g. model) needs no confirmation', async () => {
    const confirmSpy = stubConfirm(true);
    wordLadderAdminApi.words.mockResolvedValue(ok(payload({
      words: [{
        wordId: 'word_1', term: '사과', gloss: 'apple', state: 'learning', stage: 2,
        dueDay: '2026-09-20', missStreak: 1, tricky: false, excluded: false, lastGraded: '2026-09-18',
        recentTyped: [{ day: '2026-09-18', itemId: 'item_1', typed: 'sagwaa', score: 6, judge: 'model', reason: 'close', correct: false, source: 'typed', regraded: null }],
      }],
    })));
    wordLadderAdminApi.regrade.mockResolvedValue(ok({ learnerId: 'learner_a', wordId: 'word_1', day: '2026-09-18', itemId: 'item_1', regraded: {} }));
    mount();
    const row = (await screen.findByText('사과')).closest('tr');
    fireEvent.click(within(row).getByRole('button', { name: /sagwaa/ }));
    fireEvent.click(within(row).getByRole('button', { name: 'Fail' }));
    expect(confirmSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(wordLadderAdminApi.regrade).toHaveBeenCalled());
  });
});

describe('Deck pool', () => {
  it('shows Drop from pool only for droppableDecks', async () => {
    wordLadderAdminApi.dropDeck.mockResolvedValue(ok({ learnerId: 'learner_a', decksSeen: ['language/korean/week-01-classroom'] }));
    mount();
    await screen.findByText('사과');
    const currentRow = screen.getByText('language/korean/week-01-classroom').closest('li');
    const droppableRow = screen.getByText('language/korean/week-02-food').closest('li');
    expect(within(currentRow).queryByRole('button', { name: 'Drop from pool' })).toBeNull();
    expect(within(currentRow).getByText(/current/i)).toBeTruthy();
    expect(within(droppableRow).getByRole('button', { name: 'Drop from pool' })).toBeTruthy();
  });

  it('drops a droppable deck from the pool', async () => {
    wordLadderAdminApi.dropDeck.mockResolvedValue(ok({ learnerId: 'learner_a', decksSeen: ['language/korean/week-01-classroom'] }));
    mount();
    await screen.findByText('사과');
    fireEvent.click(screen.getByRole('button', { name: 'Drop from pool' }));
    await waitFor(() => expect(wordLadderAdminApi.dropDeck).toHaveBeenCalledWith(
      expect.objectContaining({ learnerId: 'learner_a', deckId: 'language/korean/week-01-classroom', dropDeckId: 'language/korean/week-02-food' }),
    ));
  });
});
