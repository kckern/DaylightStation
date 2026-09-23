import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import WordLadderProgram from './WordLadderProgram.jsx';

vi.mock('./WordLadderStage.jsx', () => ({ default: ({ children }) => <div data-testid="stage">{children}</div> }));
vi.mock('./wordLadderAudio.js', () => ({ playClip: vi.fn(async () => true) }));
const logs = vi.hoisted(() => ({ sessionReopened: vi.fn() }));
vi.mock('./wordLadderLog.js', async (importOriginal) => {
  const actual = await importOriginal();
  const wrapped = { ...actual.wordLadderLog, sessionReopened: logs.sessionReopened };
  return { ...actual, wordLadderLog: wrapped, default: wrapped };
});

const word = { wordId: 'gawi', term: '가위', gloss: 'Scissors', kind: 'word', media: {} };
const progress = { phase: 'round', rechecksLeft: 0, round: { index: 1, kind: 'new', size: 2, phase: 'intro', remainingInStream: 0, quizLeft: 0 }, activeMs: 0, capMs: 900000 };
const intro = { id: 'r1:i:gawi:flash', type: 'flashcard', mode: 'intro', wordId: 'gawi', word };
const copy = { id: 'r1:i:gawi:copy', type: 'copy', wordId: 'gawi', word };
const choice = { id: 'r1:q:0', type: 'choice', task: '2.2', channel: 'read', wordId: 'gawi', prompt: '가위', choices: ['Glue', 'Scissors', 'Book', 'Pen'], assets: {} };
const stream = { id: 'r1:s:0', type: 'flashcard', mode: 'stream', wordId: 'gawi', word };

function openWith(item, sittingId = 's') {
  return { ok: true, status: 200, data: { sittingId, package: 'korean-vocab', language: { code: 'ko' }, gloss: { code: 'en' }, item, progress } };
}

/** Renders the program and taps Start (spec §6: the sitting opens on a Start tap, which unlocks audio). */
function renderStarted(ui) {
  const view = render(ui);
  fireEvent.click(screen.getByRole('button', { name: /start/i }));
  return view;
}

function fakeApi(test = false) {
  return {
    test,
    open: vi.fn(async () => openWith(intro)),
    respond: vi.fn(async () => ({ ok: true, status: 200, data: { result: { ok: true }, item: copy, progress } })),
    get: vi.fn(),
    close: vi.fn(async () => ({ ok: true })),
  };
}

describe('WordLadderProgram — Start screen', () => {
  it('does not open the sitting until Start is tapped', async () => {
    const api = fakeApi();
    render(<WordLadderProgram descriptor={{ deckId: 'd', userId: 'test-learner' }} api={api} />);
    expect(screen.getByRole('heading', { name: 'Words' })).toBeInTheDocument();
    expect(api.open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /start/i }));
    await screen.findByText('가위');
    expect(api.open).toHaveBeenCalledTimes(1);
  });

  it('shows the descriptor title when one is known', () => {
    render(<WordLadderProgram descriptor={{ deckId: 'd', userId: 'test-learner', title: 'Korean words' }} api={fakeApi()} />);
    expect(screen.getByRole('heading', { name: 'Korean words' })).toBeInTheDocument();
  });

  it('Space and Enter start the sitting too', async () => {
    for (const key of [' ', 'Enter']) {
      const api = fakeApi();
      const { unmount } = render(<WordLadderProgram descriptor={{ deckId: 'd', userId: 'test-learner' }} api={api} />);
      act(() => { fireEvent.keyDown(window, { key }); });
      await screen.findByText('가위');
      expect(api.open).toHaveBeenCalledTimes(1);
      unmount();
    }
  });

  it('a test sitting shows the banner on the Start screen', () => {
    render(<WordLadderProgram descriptor={{ deckId: 'd', userId: 'test-learner', test: true }} api={fakeApi(true)} />);
    expect(screen.getByText(/TEST — nothing is saved/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start/i })).toBeInTheDocument();
  });

  it('Leave before Start exits without opening or closing anything', () => {
    const api = fakeApi();
    const onExit = vi.fn();
    render(<WordLadderProgram descriptor={{ deckId: 'd', userId: 'test-learner' }} api={api} onExit={onExit} />);
    fireEvent.click(screen.getByRole('button', { name: /leave/i }));
    expect(onExit).toHaveBeenCalled();
    expect(api.open).not.toHaveBeenCalled();
    expect(api.close).not.toHaveBeenCalled();
  });
});

describe('WordLadderProgram', () => {
  it('opens, advances an intro card with Space, and shows the next item', async () => {
    const api = fakeApi();
    renderStarted(<WordLadderProgram descriptor={{ deckId: 'd', userId: 'test-learner' }} api={api} />);
    await screen.findByText('가위');
    act(() => { fireEvent.keyDown(window, { key: ' ' }); });
    act(() => { fireEvent.keyDown(window, { key: ' ' }); });
    await waitFor(() => expect(api.respond).toHaveBeenCalledWith('s', expect.objectContaining({ itemId: 'r1:i:gawi:flash', response: { seen: true } })));
    expect(await screen.findByLabelText('Your answer')).toBeInTheDocument();
  });

  it('a test sitting shows the banner', async () => {
    renderStarted(<WordLadderProgram descriptor={{ deckId: 'd', userId: 'test-learner', test: true }} api={fakeApi(true)} />);
    expect(await screen.findByText(/TEST — nothing is saved/)).toBeInTheDocument();
  });

  it('a live sitting shows no banner', async () => {
    renderStarted(<WordLadderProgram descriptor={{ deckId: 'd', userId: 'test-learner' }} api={fakeApi()} />);
    await screen.findByText('가위');
    expect(screen.queryByText(/TEST — nothing is saved/)).toBeNull();
  });

  it('opens with the descriptor scenario', async () => {
    const api = fakeApi(true);
    renderStarted(<WordLadderProgram descriptor={{ deckId: 'd', userId: 'test-learner', test: true, scenario: 'round-end' }} api={api} />);
    await screen.findByText('가위');
    expect(api.open).toHaveBeenCalledWith({
      userId: 'test-learner', deckId: 'd', scenario: 'round-end', capabilities: { microphone: false },
    });
  });

  it('a graded result stays on the current item until Next, then swaps to the returned item', async () => {
    const api = fakeApi();
    api.open.mockResolvedValue(openWith(choice));
    api.respond.mockResolvedValue({ ok: true, status: 200, data: { result: { correct: false, answer: 'Scissors' }, item: stream, progress } });
    renderStarted(<WordLadderProgram descriptor={{ deckId: 'd', userId: 'test-learner' }} api={api} />);
    await screen.findByText('Glue');
    act(() => { fireEvent.keyDown(window, { key: '1' }); });
    expect(await screen.findByText("It's Scissors")).toBeInTheDocument();
    // The response is exactly what the item sent — no flags spread in.
    expect(api.respond).toHaveBeenCalledWith('s', { userId: 'test-learner', itemId: 'r1:q:0', response: { choice: 'Glue' } });
    expect(screen.getByText('Glue')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Flashcard' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(await screen.findByRole('region', { name: 'Flashcard' })).toBeInTheDocument();
  });

  it('a copy mismatch keeps the copy item and says try again', async () => {
    const api = fakeApi();
    api.open.mockResolvedValue(openWith(copy));
    api.respond.mockResolvedValue({ ok: true, status: 200, data: { result: { correct: false, answer: '가위' }, item: copy, progress } });
    renderStarted(<WordLadderProgram descriptor={{ deckId: 'd', userId: 'test-learner' }} api={api} />);
    const input = await screen.findByLabelText('Your answer');
    fireEvent.change(input, { target: { value: '가' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText(/Try again/)).toBeInTheDocument();
    expect(screen.getByLabelText('Your answer')).toBeInTheDocument();
  });

  it('a 404 from respond re-opens the sitting and logs sessionReopened', async () => {
    const api = fakeApi();
    api.open.mockResolvedValueOnce(openWith(intro, 's-old')).mockResolvedValueOnce(openWith(copy, 's-new'));
    api.respond.mockResolvedValueOnce({ ok: false, status: 404, data: null });
    renderStarted(<WordLadderProgram descriptor={{ deckId: 'd', userId: 'test-learner' }} api={api} />);
    await screen.findByText('가위');
    act(() => { fireEvent.keyDown(window, { key: ' ' }); });
    act(() => { fireEvent.keyDown(window, { key: ' ' }); });
    expect(await screen.findByLabelText('Your answer')).toBeInTheDocument();
    expect(api.open).toHaveBeenCalledTimes(2);
    expect(logs.sessionReopened).toHaveBeenCalled();
  });

  it('Leave closes the sitting with reason leave, then exits', async () => {
    const api = fakeApi();
    const onExit = vi.fn();
    renderStarted(<WordLadderProgram descriptor={{ deckId: 'd', userId: 'test-learner' }} api={api} onExit={onExit} />);
    await screen.findByText('가위');
    fireEvent.click(screen.getByRole('button', { name: /leave/i }));
    await waitFor(() => expect(onExit).toHaveBeenCalled());
    expect(api.close).toHaveBeenCalledWith('s', { userId: 'test-learner', reason: 'leave' });
  });

  it('an open failure says so and offers Back', async () => {
    const api = fakeApi();
    api.open.mockResolvedValue({ ok: false, status: 404, data: null });
    renderStarted(<WordLadderProgram descriptor={{ deckId: 'd', userId: 'test-learner' }} api={api} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('not ready');
  });

  it('Leave closes once as leave — unmount afterwards sends nothing more', async () => {
    const api = fakeApi();
    const { unmount } = renderStarted(<WordLadderProgram descriptor={{ deckId: 'd', userId: 'test-learner' }} api={api} />);
    await screen.findByText('가위');
    fireEvent.click(screen.getByRole('button', { name: /leave/i }));
    await waitFor(() => expect(api.close).toHaveBeenCalledTimes(1));
    unmount();
    expect(api.close).toHaveBeenCalledTimes(1);
    expect(api.close).toHaveBeenCalledWith('s', { userId: 'test-learner', reason: 'leave' });
  });

  it('summary Done closes as goal when under the cap', async () => {
    const api = fakeApi();
    const onExit = vi.fn();
    api.open.mockResolvedValue({ ...openWith({ id: 'summary', type: 'summary', quizzed: 4, doneToday: true }), data: { ...openWith(null).data, item: { id: 'summary', type: 'summary', quizzed: 4, doneToday: true }, progress: { phase: 'summary', rechecksLeft: 0, round: null, activeMs: 300000, capMs: 900000 } } });
    renderStarted(<WordLadderProgram descriptor={{ deckId: 'd', userId: 'test-learner' }} api={api} onExit={onExit} />);
    fireEvent.click(await screen.findByRole('button', { name: /done/i }));
    await waitFor(() => expect(onExit).toHaveBeenCalled());
    expect(api.close).toHaveBeenCalledWith('s', { userId: 'test-learner', reason: 'goal' });
  });

  it('summary Done closes as cap when the time cap was reached', async () => {
    const api = fakeApi();
    const onExit = vi.fn();
    api.open.mockResolvedValue({ ...openWith(null), data: { ...openWith(null).data, item: { id: 'summary', type: 'summary', quizzed: 4, doneToday: true }, progress: { phase: 'summary', rechecksLeft: 0, round: null, activeMs: 900000, capMs: 900000 } } });
    renderStarted(<WordLadderProgram descriptor={{ deckId: 'd', userId: 'test-learner' }} api={api} onExit={onExit} />);
    fireEvent.click(await screen.findByRole('button', { name: /done/i }));
    await waitFor(() => expect(onExit).toHaveBeenCalled());
    expect(api.close).toHaveBeenCalledWith('s', { userId: 'test-learner', reason: 'cap' });
    expect(api.close).toHaveBeenCalledTimes(1);
  });

  it('unmounting with an open sitting closes it as unmount', async () => {
    const api = fakeApi();
    const { unmount } = renderStarted(<WordLadderProgram descriptor={{ deckId: 'd', userId: 'test-learner' }} api={api} />);
    await screen.findByText('가위');
    unmount();
    expect(api.close).toHaveBeenCalledWith('s', { userId: 'test-learner', reason: 'unmount' });
  });

  it('a reopened sitting remounts the card even when the item id repeats', async () => {
    const api = fakeApi();
    api.open.mockResolvedValueOnce(openWith(intro, 's-old')).mockResolvedValueOnce(openWith(intro, 's-new'));
    api.respond.mockResolvedValueOnce({ ok: false, status: 404, data: null });
    renderStarted(<WordLadderProgram descriptor={{ deckId: 'd', userId: 'test-learner' }} api={api} />);
    await screen.findByText('가위');
    act(() => { fireEvent.keyDown(window, { key: ' ' }); });
    expect(screen.getByText('Scissors')).toBeInTheDocument();
    act(() => { fireEvent.keyDown(window, { key: ' ' }); });
    await waitFor(() => expect(api.open).toHaveBeenCalledTimes(2));
    // Same item id, new sitting: the card starts on its front again.
    await waitFor(() => expect(screen.queryByText('Scissors')).toBeNull());
    expect(screen.getByText('가위')).toBeInTheDocument();
  });
});
