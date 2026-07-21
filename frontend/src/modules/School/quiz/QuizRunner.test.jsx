import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import QuizRunner from './QuizRunner.jsx';

const answerMock = vi.fn();
vi.mock('../schoolApi.js', () => ({
  schoolApi: {
    openSession: vi.fn(async () => ({ ok: true, status: 200, data: { sessionId: 'ses_1' } })),
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

beforeEach(() => {
  profile = { currentUser: { id: 'kid1', name: 'KID1' }, isGuest: false };
  answerMock.mockReset().mockResolvedValue({ ok: true, status: 200, data: { correct: true, expected: 'Olympia', attemptId: 'att_1' } });
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
    profile = { currentUser: null, isGuest: false }; // lapse
    rerender(<QuizRunner bank={bank} onExit={onExit} />);
    await waitFor(() => expect(onExit).toHaveBeenCalled());
  });
});
