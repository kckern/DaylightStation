import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FlashcardRunner from './FlashcardRunner.jsx';

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
  { id: 'q1', type: 'short_answer', prompt: 'OR?', answer: 'Salem' },
  { id: 'q2', type: 'short_answer', prompt: 'WA?', answer: 'Olympia' },
] };

const matchingBank = { id: 'match', title: 'Match', items: [
  { id: 'm1', type: 'matching', prompt: 'Match these', pairs: [{ left: 'WA', right: 'Olympia' }] },
] };

beforeEach(() => {
  profile = { status: 'ready', currentUser: { id: 'kid1' }, isGuest: false };
  openSessionMock.mockReset().mockResolvedValue({ ok: true, status: 200, data: { sessionId: 'ses_1' } });
  answerMock.mockReset().mockResolvedValue({ ok: true, status: 200, data: { attemptId: 'att_1' } });
});

describe('FlashcardRunner', () => {
  it('reveal -> self-grade posts selfGrade, never given', async () => {
    render(<FlashcardRunner bank={bank} onExit={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /show answer/i }));
    expect(screen.getByText('Salem')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /got it/i }));
    await waitFor(() => expect(answerMock).toHaveBeenCalledWith('ses_1', { itemId: 'q1', selfGrade: 'correct' }));
    expect(answerMock.mock.calls[0][1].given).toBeUndefined();
  });

  it('a missed card resurfaces before the session ends (R4.3)', async () => {
    render(<FlashcardRunner bank={bank} onExit={() => {}} />);
    // miss q1
    fireEvent.click(await screen.findByRole('button', { name: /show answer/i }));
    fireEvent.click(screen.getByRole('button', { name: /missed/i }));
    // q2 got
    fireEvent.click(await screen.findByRole('button', { name: /show answer/i }));
    fireEvent.click(screen.getByRole('button', { name: /got it/i }));
    // q1 comes back
    expect(await screen.findByText('OR?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /show answer/i }));
    fireEvent.click(screen.getByRole('button', { name: /got it/i }));
    expect(await screen.findByTestId('cards-summary')).toHaveTextContent('1 / 2'); // first-try count
  });

  it('any item type is drillable: a matching card reveals the pair list', async () => {
    render(<FlashcardRunner bank={matchingBank} onExit={() => {}} />);
    expect(await screen.findByText('Match these')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /show answer/i }));
    expect(screen.getByText(/WA/)).toBeInTheDocument();
    expect(screen.getByText(/Olympia/)).toBeInTheDocument();
  });

  it('shows a loading state (not a live card) before the session opens, so an early tap cannot be swallowed', async () => {
    let resolveOpen;
    openSessionMock.mockReset().mockImplementationOnce(() => new Promise((resolve) => { resolveOpen = resolve; }));
    render(<FlashcardRunner bank={bank} onExit={() => {}} />);
    expect(screen.getByTestId('cards-loading')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /show answer/i })).not.toBeInTheDocument();
    resolveOpen({ ok: true, status: 200, data: { sessionId: 'ses_1' } });
    expect(await screen.findByRole('button', { name: /show answer/i })).toBeInTheDocument();
  });

  it('waits for the profile context to be ready before opening a session, pinning identity at that same moment', async () => {
    const onExit = vi.fn();
    profile = { status: 'loading', currentUser: null, isGuest: false };
    const { rerender } = render(<FlashcardRunner bank={bank} onExit={onExit} />);
    expect(openSessionMock).not.toHaveBeenCalled();
    profile = { status: 'ready', currentUser: { id: 'kid1' }, isGuest: false };
    rerender(<FlashcardRunner bank={bank} onExit={onExit} />);
    await waitFor(() => expect(openSessionMock).toHaveBeenCalledTimes(1));
    expect(openSessionMock).toHaveBeenCalledWith({ userId: 'kid1', bankId: 'caps', mode: 'flashcard' });
    expect(onExit).not.toHaveBeenCalled(); // must not read this as a mid-drill identity change
  });

  it('stops recording immediately when identity changes, even before the parent unmounts the runner', async () => {
    const onExit = vi.fn();
    const { rerender } = render(<FlashcardRunner bank={bank} onExit={onExit} />);
    const showBtn = await screen.findByRole('button', { name: /show answer/i });
    fireEvent.click(showBtn);
    const gotBtn = screen.getByRole('button', { name: /got it/i });
    profile = { status: 'ready', currentUser: null, isGuest: false }; // lapse mid-drill
    rerender(<FlashcardRunner bank={bank} onExit={onExit} />);
    await waitFor(() => expect(onExit).toHaveBeenCalled());
    answerMock.mockClear();
    fireEvent.click(gotBtn); // still mounted; parent hasn't unmounted yet
    expect(answerMock).not.toHaveBeenCalled();
  });

  it('exits on a 410 (session gone)', async () => {
    const onExit = vi.fn();
    answerMock.mockResolvedValueOnce({ ok: false, status: 410, data: null });
    render(<FlashcardRunner bank={bank} onExit={onExit} />);
    fireEvent.click(await screen.findByRole('button', { name: /show answer/i }));
    fireEvent.click(screen.getByRole('button', { name: /got it/i }));
    await waitFor(() => expect(onExit).toHaveBeenCalled());
  });

  it('a failed self-grade recording does not strand the child — it still advances and is surfaced on the summary', async () => {
    answerMock.mockResolvedValueOnce({ ok: false, status: 500, data: null });
    render(<FlashcardRunner bank={bank} onExit={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /show answer/i }));
    fireEvent.click(screen.getByRole('button', { name: /got it/i }));
    // second card should be reachable — not stuck on q1
    expect(await screen.findByText('WA?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /show answer/i }));
    fireEvent.click(screen.getByRole('button', { name: /got it/i }));
    const summary = await screen.findByTestId('cards-summary');
    expect(summary).toHaveTextContent(/not recorded/i);
  });

  it('a failed self-grade recording surfaces an immediate per-card indicator, not just the end-of-session summary', async () => {
    answerMock.mockResolvedValueOnce({ ok: false, status: 500, data: null });
    render(<FlashcardRunner bank={bank} onExit={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /show answer/i }));
    fireEvent.click(screen.getByRole('button', { name: /got it/i }));
    expect(await screen.findByTestId('unrecorded')).toHaveTextContent(/answer not recorded/i);
  });

  it('a double-tap on Got it produces exactly one POST and does not drop the next card', async () => {
    let resolveAnswer;
    answerMock.mockImplementationOnce(() => new Promise((resolve) => { resolveAnswer = resolve; }));
    render(<FlashcardRunner bank={bank} onExit={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /show answer/i }));
    const gotBtn = screen.getByRole('button', { name: /got it/i });
    fireEvent.click(gotBtn);
    fireEvent.click(gotBtn); // double-tap before the first POST resolves
    resolveAnswer({ ok: true, status: 200, data: { attemptId: 'att_1' } });
    // q2 must still be reachable — a re-entrant grade() must not silently
    // drop it from the queue via a duplicate slice(1).
    expect(await screen.findByText('WA?')).toBeInTheDocument();
    expect(answerMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /show answer/i }));
    fireEvent.click(screen.getByRole('button', { name: /got it/i }));
    const summary = await screen.findByTestId('cards-summary');
    expect(summary).toHaveTextContent('2 / 2'); // both cards graded first-try, none dropped
  });

  it('disables the grade buttons while a grade is in flight, as the honest affordance for the guard', async () => {
    let resolveAnswer;
    answerMock.mockImplementationOnce(() => new Promise((resolve) => { resolveAnswer = resolve; }));
    render(<FlashcardRunner bank={bank} onExit={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /show answer/i }));
    const gotBtn = screen.getByRole('button', { name: /got it/i });
    const missedBtn = screen.getByRole('button', { name: /missed/i });
    fireEvent.click(gotBtn);
    expect(gotBtn).toBeDisabled();
    expect(missedBtn).toBeDisabled();
    resolveAnswer({ ok: true, status: 200, data: { attemptId: 'att_1' } });
    await waitFor(() => expect(screen.getByText('WA?')).toBeInTheDocument());
  });
});
