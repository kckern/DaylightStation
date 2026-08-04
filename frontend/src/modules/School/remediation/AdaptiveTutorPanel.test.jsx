import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AdaptiveTutorPanel from './AdaptiveTutorPanel.jsx';

const sessionMock = vi.fn();
const actionMock = vi.fn();
vi.mock('../schoolApi.js', () => ({ schoolApi: {
  remediationSession: (...args) => sessionMock(...args),
  remediationAction: (...args) => actionMock(...args),
} }));

const turn = (over = {}) => ({
  turnId: 'turn-1', serverSequence: 1, body: 'Think in equal groups.',
  prompt: 'What is 12 divided into 3 equal groups?',
  choices: [
    { id: 'A', label: '3', functionKey: 'F1' },
    { id: 'B', label: '4', functionKey: 'F2' },
  ],
  ...over,
});

const offered = {
  sessionId: 'rem-1', learnerId: 'kid-a', status: 'offered', masteryPercent: 33,
  targetPercent: 80, learnerControls: ['stop', 'skip', 'explain', 'challenge'],
  currentTurnId: null, turns: [],
  cursor: { nextClientSequence: 0, latestServerSequence: 0 },
};

const active = {
  ...offered, status: 'active', currentTurnId: 'turn-1', turns: [turn()],
  cursor: { nextClientSequence: 1, latestServerSequence: 1 },
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionMock.mockResolvedValue({ ok: true, status: 200, data: { session: offered } });
});

describe('AdaptiveTutorPanel', () => {
  it('resumes the shared session and submits deterministic F-key choice cursors', async () => {
    actionMock
      .mockResolvedValueOnce({ ok: true, status: 200, data: {
        status: 'complete', session: active,
      } })
      .mockResolvedValueOnce({ ok: true, status: 200, data: {
        status: 'complete',
        answer: { choiceId: 'B', correct: true, rationale: 'Twelve divided by three is four.' },
        session: {
          ...active, status: 'mastered', masteryPercent: 100, currentTurnId: null,
          turns: [], cursor: { nextClientSequence: 2, latestServerSequence: 1 },
          terminalSummary: {
            initialScorePercent: 33, finalMasteryPercent: 100, changePercent: 67,
            masteredConceptIds: ['equal-groups'], remainingConceptIds: [],
            completionReason: 'mastery_reached', nextAction: 'continue',
          },
        },
      } });
    render(<AdaptiveTutorPanel sessionId="rem-1" learnerId="kid-a" onExit={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Start tutoring' }));
    expect(await screen.findByText(/12 divided/)).toBeInTheDocument();
    expect(actionMock).toHaveBeenNthCalledWith(1, 'rem-1', {
      learnerId: 'kid-a', clientSequence: 0, lastServerSequence: 0, action: 'start',
    });

    fireEvent.keyDown(window, { key: 'F2' });
    expect(await screen.findByText('Mastery reached')).toBeInTheDocument();
    expect(screen.getByText('Twelve divided by three is four.')).toBeInTheDocument();
    expect(actionMock).toHaveBeenNthCalledWith(2, 'rem-1', {
      learnerId: 'kid-a', clientSequence: 1, lastServerSequence: 1,
      action: 'choice', turnId: 'turn-1', choiceId: 'B',
    });
  });

  it('retains and manually retries the exact action after a disconnect', async () => {
    sessionMock.mockResolvedValueOnce({ ok: true, status: 200, data: { session: active } });
    actionMock
      .mockResolvedValueOnce({ ok: false, status: 0, data: null })
      .mockResolvedValueOnce({ ok: true, status: 200, data: {
        status: 'complete', answer: { choiceId: 'A', correct: false, rationale: 'Try equal groups.' },
        session: { ...active, cursor: { nextClientSequence: 2, latestServerSequence: 2 } },
      } });
    render(<AdaptiveTutorPanel sessionId="rem-1" learnerId="kid-a" onExit={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: /A\. 3/ }));
    expect(await screen.findByText(/exact request is retained/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry now' }));
    expect(await screen.findByText('Not yet')).toBeInTheDocument();
    expect(actionMock).toHaveBeenCalledTimes(2);
    expect(actionMock.mock.calls[1]).toEqual(actionMock.mock.calls[0]);
  });

  it('offers learner controls without manufacturing answer evidence', async () => {
    sessionMock.mockResolvedValueOnce({ ok: true, status: 200, data: { session: active } });
    const next = {
      ...active, currentTurnId: 'turn-2', turns: [turn({
        turnId: 'turn-2', serverSequence: 2, body: 'Use a picture this time.',
      })], cursor: { nextClientSequence: 2, latestServerSequence: 2 },
    };
    actionMock.mockResolvedValueOnce({ ok: true, status: 200, data: {
      status: 'complete', control: { control: 'explain', turnId: 'turn-1' }, session: next,
    } });
    render(<AdaptiveTutorPanel sessionId="rem-1" learnerId="kid-a" onExit={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Explain another way' }));
    expect(await screen.findByText('Trying another explanation')).toBeInTheDocument();
    expect(screen.getByText('Use a picture this time.')).toBeInTheDocument();
    expect(actionMock).toHaveBeenCalledWith('rem-1', {
      learnerId: 'kid-a', clientSequence: 1, lastServerSequence: 1,
      action: 'explain', turnId: 'turn-1',
    });
    expect(screen.queryByText(/^Correct$/)).toBeNull();
    expect(screen.queryByText(/^Not yet$/)).toBeNull();
  });

  it('backs out as a pause without sending cancellation', async () => {
    const onExit = vi.fn();
    render(<AdaptiveTutorPanel sessionId="rem-1" learnerId="kid-a" onExit={onExit} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Back to progress' }));
    expect(onExit).toHaveBeenCalledOnce();
    expect(actionMock).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText(/does not discard your place/i)).toBeInTheDocument());
  });
});
