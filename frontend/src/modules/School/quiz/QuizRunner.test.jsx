import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import QuizRunner from './QuizRunner.jsx';

const answerMock = vi.fn();
const openSessionMock = vi.fn();
vi.mock('../schoolApi.js', () => ({
  schoolApi: {
    openSession: (...a) => openSessionMock(...a),
    answer: (...a) => answerMock(...a),
  },
}));

let profile;
vi.mock('../identity/SchoolProfileContext.jsx', () => ({
  useSchoolProfile: () => profile,
}));

const bank = { id: 'caps', title: 'Caps', items: [
  { id: 'q1', type: 'multiple_choice', prompt: 'WA?', answer: 'Olympia', choices: ['Seattle', 'Olympia'] },
  { id: 'q2', type: 'multiple_choice', prompt: 'OR?', answer: 'Salem', choices: ['Salem', 'Boise'] },
] };

const matchingBank = { id: 'match', title: 'Match', items: [
  { id: 'm1', type: 'matching', prompt: 'Match', pairs: [{ left: 'WA', right: 'Olympia' }] },
] };

beforeEach(() => {
  profile = { status: 'ready', currentUser: { id: 'kid1', name: 'KID1' }, isGuest: false };
  answerMock.mockReset().mockResolvedValue({ ok: true, status: 200, data: { correct: true, expected: 'Olympia', attemptId: 'att_1' } });
  openSessionMock.mockReset().mockResolvedValue({ ok: true, status: 200, data: { sessionId: 'ses_1' } });
});

describe('QuizRunner', () => {
  it('runs one pass — a wrong answer is NOT re-asked — and ends on a summary', async () => {
    answerMock
      .mockResolvedValueOnce({ ok: true, status: 200, data: { correct: false, expected: 'Olympia', attemptId: 'att_1' } })
      .mockResolvedValueOnce({ ok: true, status: 200, data: { correct: true, expected: 'Salem', attemptId: 'att_2' } });
    render(<QuizRunner bank={bank} onExit={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Seattle' })); // wrong
    fireEvent.click(await screen.findByRole('button', { name: /next/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Salem' }));  // right
    fireEvent.click(await screen.findByRole('button', { name: /next/i }));
    expect(await screen.findByTestId('quiz-summary')).toHaveTextContent('1 / 2');
    expect(answerMock).toHaveBeenCalledTimes(2); // strictly one POST per item
  });
  it('shows the unrecorded banner on a 500 and still allows continuing', async () => {
    answerMock.mockResolvedValueOnce({ ok: false, status: 500, data: { error: 'internal' } });
    render(<QuizRunner bank={bank} onExit={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Olympia' }));
    expect(await screen.findByTestId('unrecorded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
  });
  it('exits on a 410 (session gone after restart)', async () => {
    const onExit = vi.fn();
    answerMock.mockResolvedValueOnce({ ok: false, status: 410, data: null });
    render(<QuizRunner bank={bank} onExit={onExit} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Olympia' }));
    await waitFor(() => expect(onExit).toHaveBeenCalled());
  });
  it('abandons the run when identity changes mid-quiz', async () => {
    const onExit = vi.fn();
    const { rerender } = render(<QuizRunner bank={bank} onExit={onExit} />);
    await screen.findByRole('button', { name: 'Olympia' });
    profile = { status: 'ready', currentUser: null, isGuest: false }; // lapse
    rerender(<QuizRunner bank={bank} onExit={onExit} />);
    await waitFor(() => expect(onExit).toHaveBeenCalled());
  });

  it('a failed recording produces an unrecorded verdict that does not crash a MatchingItem (no expected/correct claimed)', async () => {
    answerMock.mockResolvedValueOnce({ ok: false, status: 500, data: { error: 'internal' } });
    render(<QuizRunner bank={matchingBank} onExit={() => {}} />);
    const left = await screen.findByRole('button', { name: 'WA' });
    fireEvent.pointerDown(left);
    fireEvent.pointerUp(left);
    const right = screen.getByRole('button', { name: 'Olympia' });
    fireEvent.pointerDown(right);
    fireEvent.pointerUp(right);
    fireEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(await screen.findByTestId('unrecorded')).toBeInTheDocument();
    // The runner must still be alive and offer a way forward — no crash.
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
  });

  it('shows a loading state (not a live item) before the session opens, so an early tap cannot be swallowed', async () => {
    let resolveOpen;
    openSessionMock.mockReset().mockImplementationOnce(() => new Promise((resolve) => { resolveOpen = resolve; }));
    render(<QuizRunner bank={bank} onExit={() => {}} />);
    expect(screen.getByTestId('quiz-loading')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Seattle' })).not.toBeInTheDocument();
    resolveOpen({ ok: true, status: 200, data: { sessionId: 'ses_1' } });
    expect(await screen.findByRole('button', { name: 'Seattle' })).toBeInTheDocument();
  });

  it('stops recording immediately when identity changes, even before the parent unmounts the runner', async () => {
    const onExit = vi.fn();
    const { rerender } = render(<QuizRunner bank={bank} onExit={onExit} />);
    const btn = await screen.findByRole('button', { name: 'Olympia' });
    profile = { status: 'ready', currentUser: null, isGuest: false }; // lapse mid-quiz
    rerender(<QuizRunner bank={bank} onExit={onExit} />); // parent does NOT unmount synchronously
    await waitFor(() => expect(onExit).toHaveBeenCalled());
    answerMock.mockClear();
    fireEvent.click(btn); // a tap still reaches the still-mounted child
    expect(answerMock).not.toHaveBeenCalled();
  });

  it('summary surfaces an unrecorded count separately instead of silently scoring it as wrong', async () => {
    answerMock
      .mockResolvedValueOnce({ ok: false, status: 500, data: { error: 'internal' } })
      .mockResolvedValueOnce({ ok: true, status: 200, data: { correct: true, expected: 'Salem', attemptId: 'att_2' } });
    render(<QuizRunner bank={bank} onExit={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Olympia' })); // fails to record
    fireEvent.click(await screen.findByRole('button', { name: /next/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Salem' })); // correct + recorded
    fireEvent.click(await screen.findByRole('button', { name: /next/i }));
    const summary = await screen.findByTestId('quiz-summary');
    expect(summary).toHaveTextContent('1 / 1'); // 1 correct out of 1 GRADED item, not 1/2
    expect(await screen.findByTestId('unrecorded-summary')).toHaveTextContent('1');
  });

  it('waits for the profile context to be ready before opening a session, pinning identity at that same moment', async () => {
    const onExit = vi.fn();
    profile = { status: 'loading', currentUser: null, isGuest: false };
    const { rerender } = render(<QuizRunner bank={bank} onExit={onExit} />);
    expect(openSessionMock).not.toHaveBeenCalled();
    // Roster resolves a moment later: status flips ready and identity settles together.
    profile = { status: 'ready', currentUser: { id: 'kid1', name: 'KID1' }, isGuest: false };
    rerender(<QuizRunner bank={bank} onExit={onExit} />);
    await waitFor(() => expect(openSessionMock).toHaveBeenCalledTimes(1));
    expect(openSessionMock).toHaveBeenCalledWith({ userId: 'kid1', bankId: 'caps', mode: 'quiz' });
    expect(onExit).not.toHaveBeenCalled(); // must not read this as a mid-quiz identity change
  });
});
