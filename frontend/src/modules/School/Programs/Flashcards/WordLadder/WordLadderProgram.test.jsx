import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ caps: { microphone: true }, handlers: null, takeMs: 1500, capabilityCalls: [] }));
vi.mock('../../SentenceLadder/useCapabilities.js', () => ({
  useCapabilities: (key, languages) => {
    h.capabilityCalls.push({ key, languages });
    return { capabilities: { microphone: h.caps.microphone, textInput: [] }, ready: true };
  },
}));
vi.mock('../../SentenceLadder/rungs/useVoiceCapture.js', () => ({
  default: (handlers) => {
    h.handlers = handlers;
    return {
      start: vi.fn(async () => true),
      stop: vi.fn(() => h.handlers.onTake?.({ blob: new Blob(['take'], { type: 'audio/webm' }), durationMs: h.takeMs })),
      cancel: vi.fn(), release: vi.fn(), stream: null, isRecording: false,
    };
  },
}));
vi.mock('../../SentenceLadder/rungs/VoiceBand.jsx', () => ({ default: () => null }));
vi.mock('./wordLadderAudio.js', () => ({ playClip: vi.fn(async () => true), playSequence: vi.fn(async () => {}) }));
vi.mock('./wordLadderLog.js', () => ({
  wordLadderLog: new Proxy({}, { get: () => vi.fn() }),
}));

import WordLadderProgram, { nextStep } from './WordLadderProgram.jsx';

const card = (wordId, term, gloss, media = { image: null, audio: null }) => ({ wordId, kind: 'word', term, gloss, pronunciation: null, media });
const GAWI = card('gawi', '가위', 'Scissors');
const PUL = card('pul', '풀', 'Glue');
const basePlan = (over = {}) => ({
  day: '2026-09-22', deckId: 'language/korean/week-01-classroom',
  package: 'korean-vocab', title: 'Korean words', language: { code: 'ko', name: 'Korean' }, gloss: { code: 'en', name: 'English' },
  checks: [{ wordId: 'gawi', kind: 'word', phase: 'check', direction: 'term_to_gloss', prompt: { type: 'text', text: '가위' }, choices: ['Knife', 'Scissors', 'Tape', 'Ruler'], done: false, correct: null }],
  study: [{ wordId: 'pul', studied: false, recording: null, marked: null, done: false, card: PUL }],
  review: [], deckCards: [GAWI, PUL], remaining: { checks: 1, study: 1, review: 0 }, doneToday: false, progressLabel: '1 check · 1 to study',
  ...over,
});
const checked = (plan) => ({ ...plan, checks: plan.checks.map((c) => ({ ...c, done: true, correct: true })) });
const studied = (plan, recording = 'taken') => ({ ...plan, study: plan.study.map((s) => ({ ...s, studied: true, recording })) });
const finished = (plan) => ({ ...plan, study: plan.study.map((s) => ({ ...s, marked: 'know', done: true })), doneToday: true, progressLabel: 'Done for today' });

function fakeApi(plan) {
  let current = plan;
  return {
    open: vi.fn(async () => ({ ok: true, status: 200, data: { sessionId: 's1', day: '2026-09-22', folded: 0, plan: current } })),
    answer: vi.fn(async () => { current = checked(current); return { ok: true, status: 200, data: { correct: true, answer: 'Scissors', card: GAWI, plan: current } }; }),
    uploadRecording: vi.fn(async () => { current = studied(current); return { ok: true, status: 200, data: { take: 1, plan: current } }; }),
    mark: vi.fn(async (sessionId, { recording }) => { current = finished(recording ? studied(current, 'unavailable') : current); return { ok: true, status: 200, data: { plan: current } }; }),
    viewReview: vi.fn(async () => ({ ok: true, status: 200, data: { logged: true } })),
    plan: vi.fn(async () => ({ ok: true, status: 200, data: { plan: current } })),
    advance: (fn) => { current = fn(current); },
  };
}

beforeEach(() => {
  h.caps.microphone = true; h.takeMs = 1500; h.capabilityCalls = [];
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:take');
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe('WordLadderProgram', () => {
  it('orders the day: checks, then study, then review quiz', () => {
    const plan = basePlan();
    expect(nextStep(plan)).toMatchObject({ type: 'check', item: { wordId: 'gawi' } });
    expect(nextStep(checked(plan))).toMatchObject({ type: 'study', item: { wordId: 'pul' } });
    expect(nextStep(finished(checked(plan)))).toEqual({ type: 'done' });
  });

  it('runs a day: check → study (record, flip, "I know it") → done → review run', async () => {
    const api = fakeApi(basePlan());
    render(<WordLadderProgram descriptor={{ deckId: 'language/korean/week-01-classroom', userId: 'kid' }} api={api} resolveAssetUrl={(id) => `/assets/${id}`} />);
    expect(await screen.findByText('가위')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Scissors' }));
    expect(await screen.findByText('Right!')).toBeInTheDocument();
    expect(api.answer).toHaveBeenCalledWith('s1', { userId: 'kid', wordId: 'gawi', choice: 'Scissors' });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('풀')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Flip' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(api.uploadRecording).toHaveBeenCalledWith('s1', expect.objectContaining({ userId: 'kid', wordId: 'pul' })));
    fireEvent.click(await screen.findByRole('button', { name: 'Flip' }));
    expect(screen.getByText('Glue')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'I know it' }));
    await waitFor(() => expect(api.mark).toHaveBeenCalledWith('s1', { userId: 'kid', wordId: 'pul', mark: 'know', recording: null }));

    expect(await screen.findByText('All done for today')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review the cards' }));
    expect(await screen.findByText('가위')).toBeInTheDocument();
    await waitFor(() => expect(api.viewReview).toHaveBeenCalledWith('s1', { userId: 'kid', wordId: 'gawi' }));
    expect(screen.queryByRole('button', { name: 'I know it' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Record' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Flip' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next card' }));
    expect(await screen.findByText('풀')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Flip' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next card' }));
    expect(await screen.findByText("That's every card")).toBeInTheDocument();
    expect(api.viewReview).toHaveBeenCalledTimes(2);
  });

  it('refuses a take below the speech floor and asks again', async () => {
    h.takeMs = 400;
    const api = fakeApi(checked(basePlan()));
    render(<WordLadderProgram descriptor={{ deckId: 'd', userId: 'kid' }} api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Record' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    expect(await screen.findByText('Say the whole word, then stop.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record again' })).toBeInTheDocument();
    expect(api.uploadRecording).not.toHaveBeenCalled();
  });

  it('mic unavailable: no record step; the mark says why', async () => {
    h.caps.microphone = false;
    const api = fakeApi(checked(basePlan()));
    render(<WordLadderProgram descriptor={{ deckId: 'd', userId: 'kid' }} api={api} />);
    expect(await screen.findByText('풀')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Flip' }));
    fireEvent.click(screen.getByRole('button', { name: 'Still learning' }));
    await waitFor(() => expect(api.mark).toHaveBeenCalledWith('s1', { userId: 'kid', wordId: 'pul', mark: 'learning', recording: { status: 'unavailable', reason: 'no-device' } }));
    expect(await screen.findByText('All done for today')).toBeInTheDocument();
  });

  it('renders around missing media and shows media that exists', async () => {
    const api = fakeApi(checked(basePlan()));
    const { unmount } = render(<WordLadderProgram descriptor={{ deckId: 'd', userId: 'kid' }} api={api} />);
    expect(await screen.findByText('풀')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hear it' })).toBeNull();
    unmount();
    const withMedia = { ...PUL, media: { image: 'media:language/korean-vocab/words/week-01-classroom/pul/image.jpg', audio: 'media:language/korean-vocab/words/week-01-classroom/pul/term.mp3' } };
    const api2 = fakeApi(checked(basePlan({ study: [{ wordId: 'pul', studied: false, recording: null, marked: null, done: false, card: withMedia }] })));
    render(<WordLadderProgram descriptor={{ deckId: 'd', userId: 'kid' }} api={api2} resolveAssetUrl={(id) => `/assets/${id}`} />);
    expect(await screen.findByRole('img', { name: 'Glue' })).toHaveAttribute('src', '/assets/media:language/korean-vocab/words/week-01-classroom/pul/image.jpg');
    expect(screen.getByRole('button', { name: 'Hear it' })).toBeInTheDocument();
  });

  it('a finished day lands straight on the review run', async () => {
    const api = fakeApi(finished(checked(basePlan())));
    render(<WordLadderProgram descriptor={{ deckId: 'd', userId: 'kid' }} api={api} />);
    expect(await screen.findByRole('region', { name: 'Review card' })).toBeInTheDocument();
    expect(screen.getByText('가위')).toBeInTheDocument();
  });

  it('never shows the deck answer key while a check is open', async () => {
    const api = fakeApi(basePlan());
    const { container } = render(<WordLadderProgram descriptor={{ deckId: 'd', userId: 'kid' }} api={api} />);
    expect(await screen.findByRole('region', { name: 'Check' })).toBeInTheDocument();
    // 'Glue' is only in deckCards (and the unstudied card) — never on a check.
    expect(screen.queryByText('Glue')).toBeNull();
    expect(screen.queryByText('풀')).toBeNull();
    // The right choice is not singled out before the child answers.
    expect(container.querySelector('.is-answer')).toBeNull();
    expect(screen.queryByText('Right!')).toBeNull();
  });

  it('a refused review view is logged and never blocks the run', async () => {
    const api = { ...fakeApi(finished(checked(basePlan()))), viewReview: vi.fn(async () => ({ ok: false, status: 400, data: { error: 'not done' } })) };
    render(<WordLadderProgram descriptor={{ deckId: 'd', userId: 'kid' }} api={api} />);
    expect(await screen.findByText('가위')).toBeInTheDocument();
    await waitFor(() => expect(api.viewReview).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Flip' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next card' }));
    expect(await screen.findByText('풀')).toBeInTheDocument();
  });

  it('a lost answer response heals: says so, refetches the plan and moves on', async () => {
    const api = fakeApi(basePlan());
    // The server saved the answer; the response never made it back.
    api.answer = vi.fn(async () => { api.advance(checked); return { ok: false, status: 400, data: { error: 'no open check today' } }; });
    render(<WordLadderProgram descriptor={{ deckId: 'd', userId: 'kid' }} api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Scissors' }));
    expect(await screen.findByText("That didn't save — try again")).toBeInTheDocument();
    expect(api.plan).toHaveBeenCalledWith('s1', 'kid');
    expect(await screen.findByText('풀')).toBeInTheDocument();
  });

  it('a 404 (session gone after the study-day boundary) reopens instead of looping "didn\'t save"', async () => {
    const plan1 = basePlan();
    const plan2 = checked(basePlan()); // the fresh session's plan already has the check resolved
    const api = {
      open: vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, data: { sessionId: 's1', day: '2026-09-22', folded: 0, plan: plan1 } })
        .mockResolvedValueOnce({ ok: true, status: 200, data: { sessionId: 's2', day: '2026-09-23', folded: 0, plan: plan2 } }),
      answer: vi.fn(async () => ({ ok: false, status: 404, data: null })),
      plan: vi.fn(async () => ({ ok: true, status: 200, data: { plan: plan1 } })),
      uploadRecording: vi.fn(async () => ({ ok: true, status: 200, data: { take: 1, plan: plan2 } })),
      mark: vi.fn(async () => ({ ok: true, status: 200, data: { plan: plan2 } })),
      viewReview: vi.fn(async () => ({ ok: true, status: 200, data: { logged: true } })),
    };
    render(<WordLadderProgram descriptor={{ deckId: 'd', userId: 'kid' }} api={api} />);
    expect(await screen.findByText('가위')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Scissors' }));
    await waitFor(() => expect(api.open).toHaveBeenCalledTimes(2));
    expect(api.open).toHaveBeenLastCalledWith({ userId: 'kid', deckId: 'd' });
    expect(api.plan).not.toHaveBeenCalled();
    expect(screen.queryByText("That didn't save — try again")).toBeNull();
    expect(await screen.findByText('풀')).toBeInTheDocument();
  });

  it('two failed uploads fall back to flip-and-mark with reason upload-failed', async () => {
    const api = fakeApi(checked(basePlan()));
    api.uploadRecording = vi.fn(async () => ({ ok: false, status: 400, data: null }));
    render(<WordLadderProgram descriptor={{ deckId: 'd', userId: 'kid' }} api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Record' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(api.uploadRecording).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("That didn't save — try again")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Flip' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Record' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(api.uploadRecording).toHaveBeenCalledTimes(2));
    fireEvent.click(await screen.findByRole('button', { name: 'Flip' }));
    fireEvent.click(screen.getByRole('button', { name: 'I know it' }));
    await waitFor(() => expect(api.mark).toHaveBeenCalledWith('s1', { userId: 'kid', wordId: 'pul', mark: 'know', recording: { status: 'unavailable', reason: 'upload-failed' } }));
  });

  it('one server error on upload falls back at once', async () => {
    const api = fakeApi(checked(basePlan()));
    api.uploadRecording = vi.fn(async () => ({ ok: false, status: 503, data: null }));
    render(<WordLadderProgram descriptor={{ deckId: 'd', userId: 'kid' }} api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Record' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    expect(await screen.findByRole('button', { name: 'Flip' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record' })).toBeNull();
  });

  it('"Leave for now" exits mid-session', async () => {
    const onExit = vi.fn();
    render(<WordLadderProgram descriptor={{ deckId: 'd', userId: 'kid' }} api={fakeApi(basePlan())} onExit={onExit} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Leave for now' }));
    expect(onExit).toHaveBeenCalled();
  });

  it('a picture that fails to load is removed, not drawn broken', async () => {
    const withMedia = { ...PUL, media: { image: 'media:x/image.jpg', audio: null } };
    const api = fakeApi(checked(basePlan({ study: [{ wordId: 'pul', studied: false, recording: null, marked: null, done: false, card: withMedia }] })));
    render(<WordLadderProgram descriptor={{ deckId: 'd', userId: 'kid' }} api={api} />);
    const img = await screen.findByRole('img', { name: 'Glue' });
    fireEvent.error(img);
    expect(screen.queryByRole('img', { name: 'Glue' })).toBeNull();
  });

  it('says so when the list cannot open', async () => {
    const api = { ...fakeApi(basePlan()), open: vi.fn(async () => ({ ok: false, status: 403, data: null })) };
    const onExit = vi.fn();
    render(<WordLadderProgram descriptor={{ deckId: 'd', userId: 'kid' }} api={api} onExit={onExit} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('This word list is not ready right now.');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onExit).toHaveBeenCalled();
  });

  it('takes every language code and the capability key from the plan (a Spanish package)', async () => {
    const GATO = card('gato', 'gato', 'Cat');
    const PERRO = card('perro', 'perro', 'Dog');
    const spanish = basePlan({
      deckId: 'language/spanish/unit-01', package: 'spanish-vocab', title: 'Spanish words',
      language: { code: 'es', name: 'Spanish' }, gloss: { code: 'en', name: 'English' },
      checks: [{ wordId: 'gato', kind: 'word', phase: 'check', direction: 'term_to_gloss', prompt: { type: 'text', text: 'gato' }, choices: ['Dog', 'Cat', 'Duck', 'Rooster'], done: false, correct: null }],
      study: [{ wordId: 'perro', studied: false, recording: null, marked: null, done: false, card: PERRO }],
      deckCards: [GATO, PERRO],
    });
    const { container } = render(<WordLadderProgram descriptor={{ deckId: 'language/spanish/unit-01', userId: 'kid' }} api={fakeApi(spanish)} />);
    expect(await screen.findByText('gato')).toHaveAttribute('lang', 'es');
    expect(screen.getByRole('button', { name: 'Cat' })).toHaveAttribute('lang', 'en');
    expect(container.querySelector('[lang="ko"]')).toBeNull();
    expect(h.capabilityCalls.at(-1)).toEqual({ key: 'word-ladder:spanish-vocab', languages: { source: 'en', target: 'es' } });
    // Before the plan arrives nothing is guessed: no key, no languages.
    expect(h.capabilityCalls[0]).toEqual({ key: null, languages: { source: null, target: null } });
  });

  it('marks the Korean example\'s term and gloss with the plan\'s codes', async () => {
    h.caps.microphone = false;
    render(<WordLadderProgram descriptor={{ deckId: 'd', userId: 'kid' }} api={fakeApi(checked(basePlan()))} />);
    expect(await screen.findByText('풀')).toHaveAttribute('lang', 'ko');
    expect(screen.getByText('풀')).toHaveClass('word-ladder-term');
    fireEvent.click(screen.getByRole('button', { name: 'Flip' }));
    expect(screen.getByText('Glue')).toHaveAttribute('lang', 'en');
    expect(screen.getByText('Glue')).toHaveClass('word-ladder-gloss');
  });
});
