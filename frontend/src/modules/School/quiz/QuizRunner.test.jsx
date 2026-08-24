import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useState } from 'react';
import QuizRunner from './QuizRunner.jsx';

const answerMock = vi.fn();
const openSessionMock = vi.fn();
const requestRetakeMock = vi.fn();
const remediationOfferMock = vi.fn();
vi.mock('../schoolApi.js', () => ({
  schoolApi: {
    openSession: (...a) => openSessionMock(...a),
    answer: (...a) => answerMock(...a),
    requestRetake: (...a) => requestRetakeMock(...a),
    remediationOffer: (...a) => remediationOfferMock(...a),
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
  requestRetakeMock.mockReset().mockResolvedValue({ ok: true, status: 200, data: { requested: true } });
  remediationOfferMock.mockReset().mockResolvedValue({
    ok: true, status: 201, data: { status: 'offered', offer: { sessionId: 'REM_1' } },
  });
});

async function confirmChoice(name) {
  const choice = await screen.findByRole('button', { name });
  fireEvent.click(choice);
  fireEvent.click(choice);
}

describe('QuizRunner', () => {
  it('runs one pass — a wrong answer is NOT re-asked — and ends on a summary', async () => {
    answerMock
      .mockResolvedValueOnce({ ok: true, status: 200, data: { correct: false, expected: 'Olympia', attemptId: 'att_1' } })
      .mockResolvedValueOnce({ ok: true, status: 200, data: { correct: true, expected: 'Salem', attemptId: 'att_2' } });
    render(<QuizRunner bank={bank} onExit={() => {}} />);
    await confirmChoice('Seattle'); // wrong
    fireEvent.click(await screen.findByRole('button', { name: /next/i }));
    await confirmChoice('Salem');  // right
    fireEvent.click(await screen.findByRole('button', { name: /next/i }));
    expect(await screen.findByTestId('quiz-summary')).toHaveTextContent('1 / 2');
    expect(answerMock).toHaveBeenCalledTimes(2); // strictly one POST per item
  });
  it('shows the unrecorded banner on a 500 and still allows continuing', async () => {
    answerMock.mockResolvedValueOnce({ ok: false, status: 500, data: { error: 'internal' } });
    render(<QuizRunner bank={bank} onExit={() => {}} />);
    await confirmChoice('Olympia');
    expect(await screen.findByTestId('unrecorded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
  });
  it('shows a session-lost card on a 410 — no silent exit until Back is clicked', async () => {
    const onExit = vi.fn();
    answerMock.mockResolvedValueOnce({ ok: false, status: 410, data: null });
    render(<QuizRunner bank={bank} onExit={onExit} />);
    await confirmChoice('Olympia');
    expect(await screen.findByTestId('session-lost')).toHaveTextContent(/took a long break and timed out/i);
    expect(onExit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onExit).toHaveBeenCalled();
  });

  it('offers Start again on the session-lost card when onRestart is available', async () => {
    const onExit = vi.fn();
    const onRestart = vi.fn();
    answerMock.mockResolvedValueOnce({ ok: false, status: 410, data: null });
    render(<QuizRunner bank={bank} onExit={onExit} onRestart={onRestart} />);
    await confirmChoice('Olympia');
    await screen.findByTestId('session-lost');
    fireEvent.click(screen.getByRole('button', { name: 'Start again' }));
    expect(onRestart).toHaveBeenCalled();
    expect(onExit).not.toHaveBeenCalled();
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
    await confirmChoice('Olympia'); // fails to record
    fireEvent.click(await screen.findByRole('button', { name: /next/i }));
    await confirmChoice('Salem'); // correct + recorded
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

  it('does not advance to the next item or reach summary when identity changes while a verdict is showing', async () => {
    const onExit = vi.fn();
    const { rerender } = render(<QuizRunner bank={bank} onExit={onExit} />);
    // Answer the first item correctly
    const btn = await screen.findByRole('button', { name: 'Olympia' });
    fireEvent.click(btn);
    fireEvent.click(btn);
    // Verdict appears
    await waitFor(() => expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument());
    // Identity changes mid-quiz while verdict is showing
    profile = { status: 'ready', currentUser: null, isGuest: false }; // lapse
    rerender(<QuizRunner bank={bank} onExit={onExit} />);
    await waitFor(() => expect(onExit).toHaveBeenCalled());
    // Click the Next button that's still in the DOM (parent hasn't unmounted yet)
    const nextBtn = screen.getByRole('button', { name: /next/i });
    fireEvent.click(nextBtn);
    // Should NOT advance to the next item
    expect(screen.queryByText(/2 \/ 2/)).not.toBeInTheDocument();
    // Should NOT reach the summary
    expect(screen.queryByTestId('quiz-summary')).not.toBeInTheDocument();
  });
});

describe('student-advocacy wave 7', () => {
  it('an unsaved (guest) run carries the banner; a signed-in run does not', async () => {
    profile = { status: 'ready', currentUser: null, isGuest: true };
    render(<QuizRunner bank={bank} onExit={() => {}} />);
    expect(await screen.findByTestId('guest-banner')).toHaveTextContent(/not saved/);
  });

  it('a failed open shows the sign with a Back button, never an eternal Loading', async () => {
    openSessionMock.mockResolvedValue({ ok: false, status: 503, data: null });
    const onExit = vi.fn();
    render(<QuizRunner bank={bank} onExit={onExit} />);
    expect(await screen.findByTestId('quiz-open-failed')).toHaveTextContent(/wouldn’t open/i);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onExit).toHaveBeenCalled();
  });

  it('a failing graded run shows the pass bar honestly and offers the retake ask', async () => {
    answerMock
      .mockResolvedValueOnce({ ok: true, status: 200, data: { correct: false, expected: 'Olympia', attemptId: 'a1' } })
      .mockResolvedValueOnce({ ok: true, status: 200, data: { correct: false, expected: 'Salem', attemptId: 'a2' } });
    render(<QuizRunner bank={bank} learning={{ passingPercent: 80 }} onExit={() => {}} />);
    await confirmChoice('Seattle');
    fireEvent.click(await screen.findByRole('button', { name: /next/i }));
    await confirmChoice('Boise');
    fireEvent.click(await screen.findByRole('button', { name: /next/i }));
    expect(await screen.findByTestId('quiz-passbar')).toHaveTextContent('0% — passing is 80%. You can try again.');
    fireEvent.click(screen.getByRole('button', { name: /ask for a retake/i }));
    await waitFor(() => expect(requestRetakeMock).toHaveBeenCalledWith(
      { userId: 'kid1', bankId: 'caps', title: 'Caps' }));
    expect(await screen.findByTestId('retake-asked')).toBeInTheDocument();
  });

  it('a passing graded run celebrates and does NOT offer the retake ask', async () => {
    render(<QuizRunner bank={bank} learning={{ passingPercent: 80 }} onExit={() => {}} />);
    await confirmChoice('Olympia');
    fireEvent.click(await screen.findByRole('button', { name: /next/i }));
    await confirmChoice('Salem');
    fireEvent.click(await screen.findByRole('button', { name: /next/i }));
    expect(await screen.findByTestId('quiz-passbar')).toHaveTextContent('Passed — 100%, and passing is 80%.');
    expect(screen.getByTestId('quiz-cheer')).toHaveTextContent('Perfect! Every single one.');
    expect(screen.queryByRole('button', { name: /ask for a retake/i })).toBeNull();
    // Summary ceremony (design wave 9): one dot per question, all right here.
    expect(screen.getByTestId('quiz-dots').querySelectorAll('.is-right')).toHaveLength(2);
  });

  describe('failed Catalog quiz recovery', () => {
    const failBoth = () => {
      answerMock
        .mockResolvedValueOnce({ ok: true, status: 200, data: { correct: false, expected: 'Olympia', attemptId: 'a1' } })
        .mockResolvedValueOnce({ ok: true, status: 200, data: { correct: false, expected: 'Salem', attemptId: 'a2' } });
    };
    const runToSummary = async (labels = ['Seattle', 'Boise']) => {
      await confirmChoice(labels[0]);
      fireEvent.click(await screen.findByRole('button', { name: /next/i }));
      await confirmChoice(labels[1]);
      fireEvent.click(await screen.findByRole('button', { name: /next/i }));
      return screen.findByTestId('quiz-summary');
    };

    it('mints and opens an adaptive tutor session from the completed quiz', async () => {
      failBoth();
      const onTutor = vi.fn();
      render(<QuizRunner bank={bank} learning={{ passingPercent: 80, unitId: 'intro' }}
        onExit={() => {}} onTutor={onTutor} />);
      await runToSummary();
      await waitFor(() => expect(remediationOfferMock).toHaveBeenCalledWith('ses_1', 'kid1'));
      fireEvent.click(await screen.findByTestId('open-tutor'));
      expect(onTutor).toHaveBeenCalledWith('REM_1');
    });

    it('shows the link on a failing summary with unit context and fires onReview', async () => {
      failBoth();
      const onReview = vi.fn();
      const learning = { passingPercent: 80, unitId: 'intro' };
      render(<QuizRunner bank={bank} learning={learning} onExit={() => {}} onReview={onReview} />);
      await runToSummary();
      expect(await screen.findByTestId('quiz-passbar')).toHaveTextContent(/passing is 80%/);
      const link = screen.getByTestId('review-lesson');
      expect(link).toHaveTextContent(/review this lesson/i);
      fireEvent.click(link);
      expect(onReview).toHaveBeenCalledWith(learning);
    });

    it('does NOT show the link on a passing summary', async () => {
      const onReview = vi.fn();
      render(<QuizRunner bank={bank} learning={{ passingPercent: 80, unitId: 'intro' }} onExit={() => {}} onReview={onReview} />);
      await runToSummary(['Olympia', 'Salem']);
      expect(screen.queryByTestId('review-lesson')).toBeNull();
    });

    it('does NOT show the link when the summary lacks unit context (e.g. the materials gate quiz)', async () => {
      failBoth();
      const onReview = vi.fn();
      // Same shape SchoolMaterialPlayer hands a gate quiz today: passingPercent only.
      render(<QuizRunner bank={bank} learning={{ passingPercent: 80 }} onExit={() => {}} onReview={onReview} />);
      await runToSummary();
      expect(screen.queryByTestId('review-lesson')).toBeNull();
    });

    it('does NOT show the link when no onReview handler is wired', async () => {
      failBoth();
      render(<QuizRunner bank={bank} learning={{ passingPercent: 80, unitId: 'intro' }} onExit={() => {}} />);
      await runToSummary();
      expect(screen.queryByTestId('review-lesson')).toBeNull();
    });
  });
});

// Task 17: mid-quiz resumability — the server answers openSession with an
// optional `resume` payload; the runner picks up mid-bank instead of at q1.
describe('mid-quiz resume (Task 17)', () => {
  it('resumes at question 2 with the chip, preloaded score, and dots that include the resumed outcome', async () => {
    openSessionMock.mockReset().mockResolvedValue({ ok: true, status: 200, data: {
      sessionId: 'ses_1', resume: { answeredItemIds: ['q1'], score: 1, outcomes: [true] },
    } });
    render(<QuizRunner bank={bank} onExit={() => {}} />);
    // The chip names where the kid landed, and q2 (not q1) is on screen.
    expect(await screen.findByTestId('resume-chip'))
      .toHaveTextContent('Picked up where you left off — question 2');
    expect(screen.getByRole('button', { name: 'Salem' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Olympia' })).not.toBeInTheDocument();
    // Finish the run: the summary score and dots carry the resumed point.
    answerMock.mockResolvedValueOnce({ ok: true, status: 200, data: { correct: true, expected: 'Salem', attemptId: 'att_2' } });
    await confirmChoice('Salem');
    fireEvent.click(await screen.findByRole('button', { name: /next/i }));
    const summary = await screen.findByTestId('quiz-summary');
    expect(summary).toHaveTextContent('2 / 2');
    expect(screen.getByTestId('quiz-dots').querySelectorAll('.is-right')).toHaveLength(2);
  });

  it('no resume payload → no chip, starts at question 1', async () => {
    render(<QuizRunner bank={bank} onExit={() => {}} />);
    expect(await screen.findByRole('button', { name: 'Olympia' })).toBeInTheDocument();
    expect(screen.queryByTestId('resume-chip')).toBeNull();
  });

  it('Try again reopens the session with fresh:true (SchoolApp remount wiring)', async () => {
    // Mimics SchoolApp exactly: Try again bumps a remount nonce, and the
    // restart handler latches fresh for the remounted runner's open call.
    function Host() {
      const [nonce, setNonce] = useState(0);
      const [fresh, setFresh] = useState(false);
      return (
        <QuizRunner
          key={nonce}
          bank={bank}
          fresh={fresh}
          onExit={() => {}}
          onRestart={({ fresh: wantFresh = true } = {}) => { setFresh(wantFresh); setNonce((n) => n + 1); }}
        />
      );
    }
    render(<Host />);
    await confirmChoice('Olympia');
    fireEvent.click(await screen.findByRole('button', { name: /next/i }));
    await confirmChoice('Salem');
    fireEvent.click(await screen.findByRole('button', { name: /next/i }));
    await screen.findByTestId('quiz-summary');
    expect(openSessionMock).toHaveBeenCalledTimes(1);
    expect(openSessionMock).toHaveBeenCalledWith({ userId: 'kid1', bankId: 'caps', mode: 'quiz' });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(openSessionMock).toHaveBeenCalledTimes(2));
    expect(openSessionMock).toHaveBeenLastCalledWith({ userId: 'kid1', bankId: 'caps', mode: 'quiz', fresh: true });
  });

  it('Start again after a lost session reopens WITHOUT fresh, so the sitting resumes', async () => {
    function Host() {
      const [nonce, setNonce] = useState(0);
      const [fresh, setFresh] = useState(false);
      return (
        <QuizRunner
          key={nonce}
          bank={bank}
          fresh={fresh}
          onExit={() => {}}
          onRestart={({ fresh: wantFresh = true } = {}) => { setFresh(wantFresh); setNonce((n) => n + 1); }}
        />
      );
    }
    answerMock.mockResolvedValueOnce({ ok: false, status: 410, data: null });
    render(<Host />);
    await confirmChoice('Olympia');
    await screen.findByTestId('session-lost');
    fireEvent.click(screen.getByRole('button', { name: 'Start again' }));
    await waitFor(() => expect(openSessionMock).toHaveBeenCalledTimes(2));
    expect(openSessionMock).toHaveBeenLastCalledWith({ userId: 'kid1', bankId: 'caps', mode: 'quiz' });
  });
});
