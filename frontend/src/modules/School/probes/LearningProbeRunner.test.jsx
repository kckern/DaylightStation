import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import LearningProbeRunner from './LearningProbeRunner.jsx';

const openSession = vi.fn();
const answer = vi.fn();
const recordProbeInteraction = vi.fn();
vi.mock('../schoolApi.js', () => ({
  schoolApi: {
    openSession: (...args) => openSession(...args),
    answer: (...args) => answer(...args),
    recordProbeInteraction: (...args) => recordProbeInteraction(...args),
  },
}));
vi.mock('../schoolLog.js', () => ({ schoolLog: { session: vi.fn() } }));
let profile;
vi.mock('../identity/SchoolProfileContext.jsx', () => ({ useSchoolProfile: () => profile }));

const module = {
  moduleId: 'rate-check', type: 'learning_probe', title: 'Check the rate',
  bankId: 'rates/check', phase: 'check', difficulty: 2, conceptIds: ['unit-rate'],
  feedback: { timing: 'immediate', onIncorrect: 'explain_then_retry', maxAttemptsPerItem: 2 },
  bank: { id: 'rates/check', title: 'Rates', items: [{
    id: 'q1', type: 'multiple_choice', prompt: 'Find a unit rate with…',
    choices: ['Addition', 'Division'], answer: 'Division',
    feedback: { explanation: 'Divide by the second quantity to make it one.' },
  }] },
};

beforeEach(() => {
  profile = { status: 'ready', currentUser: { id: 'kid-a' }, isGuest: false };
  openSession.mockReset().mockResolvedValue({ ok: true, status: 200, data: { sessionId: 'ses_1' } });
  answer.mockReset();
  recordProbeInteraction.mockReset().mockResolvedValue({ ok: true, status: 201, data: {} });
});

describe('LearningProbeRunner', () => {
  it('explains, retries, and preserves the first response as the displayed score', async () => {
    answer
      .mockResolvedValueOnce({ ok: true, status: 200, data: { correct: false, expected: 'Division' } })
      .mockResolvedValueOnce({ ok: true, status: 200, data: { correct: true, expected: 'Division' } });
    render(<LearningProbeRunner module={module} learning={{ lessonId: 'rates' }} onExit={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Addition' }));
    expect(await screen.findByText(/Divide by the second quantity/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText(/attempt 2/);
    fireEvent.click(screen.getByRole('button', { name: 'Division' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));

    const summary = await screen.findByTestId('probe-summary');
    expect(summary).toHaveTextContent('Initial check: 0 / 1');
    expect(summary).toHaveTextContent('1 of 1 retry responses were correct');
    expect(answer).toHaveBeenNthCalledWith(1, 'ses_1', expect.objectContaining({
      itemId: 'q1', probeAttemptNumber: 1, responseId: 'ses_1:0:1',
    }));
    expect(answer).toHaveBeenNthCalledWith(2, 'ses_1', expect.objectContaining({
      probeAttemptNumber: 2, responseId: 'ses_1:0:2',
    }));
    expect(recordProbeInteraction.mock.calls.map(([body]) => [body.event, body.continuation ?? null]))
      .toEqual([
        ['feedback_viewed', null], ['continuation', 'retry'],
        ['feedback_viewed', null], ['continuation', 'continue'],
      ]);
  });

  it('does not advance until separately recording feedback and continuation succeeds', async () => {
    answer.mockResolvedValue({ ok: true, status: 200, data: { correct: true, expected: 'Division' } });
    recordProbeInteraction
      .mockResolvedValueOnce({ ok: true, status: 201, data: {} })
      .mockResolvedValueOnce({ ok: false, status: 0, data: null })
      .mockResolvedValue({ ok: true, status: 200, data: {} });
    render(<LearningProbeRunner module={module} onExit={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Division' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not recorded/);
    expect(screen.queryByTestId('probe-summary')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByTestId('probe-summary')).toHaveTextContent('Initial check: 1 / 1');
  });

  it('abandons the learner-scoped probe when identity changes', async () => {
    const onExit = vi.fn();
    const view = render(<LearningProbeRunner module={module} onExit={onExit} />);
    await screen.findByText('Find a unit rate with…');
    profile = { status: 'ready', currentUser: { id: 'kid-b' }, isGuest: false };
    view.rerender(<LearningProbeRunner module={module} onExit={onExit} />);
    await waitFor(() => expect(onExit).toHaveBeenCalled());
  });
});
