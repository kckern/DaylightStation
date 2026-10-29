import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import CardLadderDaysPanel from "./CardLadderDaysPanel.jsx";

const api = vi.hoisted(() => ({ days: vi.fn(), day: vi.fn(), recordingUrl: vi.fn((l, d, day, w, t, a) => `/rec/${l}/${day}/${w}/${t}?actorId=${a}`) }));
const profile = vi.hoisted(() => ({ current: { currentTeacher: { id: 'parent' } } }));
vi.mock("../cardLadderAdminApi.js", () => ({ cardLadderAdminApi: api }));
vi.mock("../TeacherProfileContext.jsx", () => ({ useTeacherProfileOptional: () => profile.current }));

const ok = (data) => ({ ok: true, status: 200, data });
const SUMMARY = { day: '2026-10-28', doneAt: '2026-10-28T16:50:43-07:00', activeMs: 207252, sittings: [], answered: 3, graded: 2, correct: 1, missedWords: ['help-neighbors'] };
const DAY = {
  ...SUMMARY,
  answers: [
    { itemId: 'rc:help-neighbors', at: '2026-10-28T16:47:31-07:00', kind: 'recheck', step: null, task: '3.3', wordId: 'help-neighbors', term: '불우 이웃을 돕다', gloss: 'help neighbors in need',
      response: { typed: 'ㅇ' }, correct: false, answer: '불우 이웃을 돕다', score: 2, judge: 'distance', reason: null, regraded: null },
    { itemId: 'rc:l02-asia', at: '2026-10-28T16:47:16-07:00', kind: 'recheck', task: '3.1', wordId: 'l02-asia', term: '아시아', gloss: 'Asia', response: { choice: '아시아' }, correct: true, answer: '아시아' },
    { itemId: 'r1:s:0', at: '2026-10-28T16:48:56-07:00', kind: 'sort', wordId: 'errand', term: '심부름', gloss: 'errand', response: { sort: 'familiar' }, correct: null },
  ],
  recordings: [{ wordId: 'errand', take: 1, ext: 'webm', term: '심부름', gloss: 'errand' }, { wordId: 'errand', take: 2, ext: 'webm', term: '심부름', gloss: 'errand' }],
};

describe('CardLadderDaysPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    profile.current = { currentTeacher: { id: 'parent' } };
    api.days.mockResolvedValue(ok({ days: [SUMMARY] }));
    api.day.mockResolvedValue(ok(DAY));
  });

  it('lists each opened day at a glance, as the picked teacher', async () => {
    render(<CardLadderDaysPanel learnerId="test-learner" deckId="language/korean-3-2/class" title="Korean 3-2" />);
    const head = await screen.findByRole('button', { name: /Wednesday, Oct 28/ });
    expect(head).toHaveTextContent('1 / 2 right · 3 min 27 s · goal met');
    expect(head).toHaveTextContent('Missed 1');
    expect(head).toHaveAttribute('aria-expanded', 'false');
    expect(api.days).toHaveBeenCalledWith('test-learner', 'language/korean-3-2/class', 'parent');
    expect(api.day).not.toHaveBeenCalled();
  });

  it('opens a day into every answer: what was asked, what they did, the verdict and the right answer', async () => {
    render(<CardLadderDaysPanel learnerId="test-learner" deckId="language/korean-3-2/class" title="Korean 3-2" />);
    fireEvent.click(await screen.findByRole('button', { name: /Wednesday, Oct 28/ }));
    const missed = (await screen.findByText('“ㅇ”')).closest('li');
    expect(within(missed).getByText('Recheck · Type from memory')).toBeInTheDocument();
    expect(within(missed).getByLabelText('Wrong')).toBeInTheDocument();
    expect(within(missed).getByText('Correct answer: 불우 이웃을 돕다')).toBeInTheDocument();
    expect(within(missed).getByText(/Judged distance, 2\/10/)).toBeInTheDocument();
    const sorted = screen.getByText('Familiar').closest('li');
    expect(within(sorted).getByLabelText('Not graded')).toBeInTheDocument();
    expect(api.day).toHaveBeenCalledWith('test-learner', 'language/korean-3-2/class', '2026-10-28', 'parent');
  });

  it('plays every kept take, grouped under its word', async () => {
    render(<CardLadderDaysPanel learnerId="test-learner" deckId="d" />);
    fireEvent.click(await screen.findByRole('button', { name: /Wednesday, Oct 28/ }));
    await screen.findByText(/Spoken takes/);
    const sources = [...document.querySelectorAll('audio')].map((audio) => audio.getAttribute('src'));
    expect(sources).toEqual(['/rec/test-learner/2026-10-28/errand/1?actorId=parent', '/rec/test-learner/2026-10-28/errand/2?actorId=parent']);
  });

  it('says so when no day was ever opened', async () => {
    api.days.mockResolvedValue(ok({ days: [] }));
    render(<CardLadderDaysPanel learnerId="test-learner" deckId="d" />);
    expect(await screen.findByText('No days opened yet for this deck.')).toBeInTheDocument();
  });
});
