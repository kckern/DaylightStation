import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CardLadderProgram from "./CardLadderProgram.jsx";

vi.mock("./CardLadderStage.jsx", () => ({ default: ({ children }) => <div data-testid="stage">{children}</div> }));
vi.mock("./cardLadderAudio.js", () => ({
  playClip: vi.fn(async () => true),
  playSequence: vi.fn(async () => {}),
  startClip: vi.fn(() => ({ done: Promise.resolve(true), stop: vi.fn() })),
  stopAudio: vi.fn(),
}));
const logs = vi.hoisted(() => ({ dictationStarted: vi.fn(), dictationAttempt: vi.fn(), dictationExited: vi.fn() }));
vi.mock("./cardLadderLog.js", async (importOriginal) => {
  const actual = await importOriginal();
  const wrapped = { ...actual.cardLadderLog, ...logs };
  return { ...actual, cardLadderLog: wrapped, default: wrapped };
});

const word = { wordId: 'gawi', term: '가위', gloss: 'Scissors', kind: 'word', media: {} };
const progress = { phase: 'round', rechecksLeft: 0, round: { index: 1, kind: 'new', size: 2, phase: 'intro', remainingInStream: 0, quizLeft: 0 }, activeMs: 0, capMs: 900000 };
const dictationProgress = { ...progress, phase: 'dictation' };
const flash = { id: 'r1:i:gawi:flash', type: 'flashcard', mode: 'intro', wordId: 'gawi', word };
const head = { channel: 'hear', listen: true, wordCount: 10, wordsDone: 3 };
const pick = { id: 'dc1:0', type: 'choice', task: 'D.1', source: 'dictation', wordId: 'gawi', dictationStep: 'match', choices: ['가위', '가방', '기위', '거위'], assets: { audio: 'words/gawi/term.mp3' }, wordIndex: 4, ...head };
const copy = { id: 'dc1:1', type: 'drill', step: 'copy', at: 1, of: 1, source: 'dictation', wordId: 'gawi', dictationStep: 'copy', word, assets: { audio: 'words/gawi/term.mp3' }, wordIndex: 4, ...head };
const blind = { id: 'dc1:2', type: 'drill', step: 'dictation', at: 1, of: 1, source: 'dictation', wordId: 'gawi', dictationStep: 'blind', assets: { audio: 'words/gawi/term.mp3' }, wordIndex: 4, ...head };
const pickAgain = { ...pick, id: 'dc1:3' };
const ready = { id: 'dc1:ready', type: 'dictation-ready', source: 'dictation', week: '2026-W46', ready: true, wordCount: 10, wordsDone: 10, needsRecording: [], unknown: [] };
const summary = { id: 'summary', type: 'summary', quizzed: 6 };
const week = (over = {}) => ({ week: '2026-W46', total: 10, remaining: 7, done: false, ready: false, count: 10, countWarning: false, needsRecording: [], unknown: [], ...over });

function openWith(item, sittingId = 's1') {
  return { ok: true, status: 200, data: { sittingId, package: 'korean-vocab', language: { code: 'ko' }, gloss: { code: 'en' }, item, progress } };
}

function fakeApi({ dictation = week(), first = pick, openItem = flash, respondWith = null } = {}) {
  return {
    test: false,
    intro: vi.fn(async () => ({ ok: true, status: 200, data: { course: { title: 'UBKS' }, today: { line: 'Today: 4 words', doneToday: false }, progress: null, ...(dictation ? { dictation } : {}) } })),
    open: vi.fn(async () => openWith(openItem)),
    dictation: vi.fn(async () => ({ ok: true, status: 200, data: { item: first, progress: dictationProgress, dictation } })),
    respond: vi.fn(respondWith ?? (async () => ({ ok: true, status: 200, data: { result: { correct: true }, item: copy, progress: dictationProgress } }))),
    get: vi.fn(),
    close: vi.fn(async () => ({ ok: true })),
  };
}

const descriptor = { deckId: 'language/korean/vocabulary', userId: 'test-learner' };
/** The field once the item has mounted and settled (its reset effect has run) — a child never types in the first frame. */
async function settledField() {
  const field = await screen.findByLabelText('Your answer');
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return field;
}

afterEach(() => { Object.values(logs).forEach((fn) => fn.mockClear()); });

describe('CardLadderProgram — weekly dictation: the start card (before the flashcards)', () => {
  it('offers "Dictation: 7 words" beside Start while the week is not done', async () => {
    render(<CardLadderProgram descriptor={descriptor} api={fakeApi()} />);
    expect(await screen.findByRole('button', { name: /Dictation: 7 words/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Start/ })).toBeInTheDocument();
  });

  it('says nothing about dictation when no week is tagged', async () => {
    const api = fakeApi({ dictation: null });
    render(<CardLadderProgram descriptor={descriptor} api={api} />);
    await waitFor(() => expect(api.intro).toHaveBeenCalled());
    await screen.findByText('Today: 4 words');
    expect(screen.queryByText(/Dictation/)).toBeNull();
  });

  it('shows "Dictation ready ✓" (no drill button) once every word is done', async () => {
    render(<CardLadderProgram descriptor={descriptor} api={fakeApi({ dictation: week({ remaining: 0, done: true, ready: true }) })} />);
    expect(await screen.findByText(/Dictation ready ✓/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Dictation: / })).toBeNull();
  });

  it('tapping it opens the sitting, starts the run and serves the D.1 pick with a Listen button', async () => {
    const api = fakeApi();
    render(<CardLadderProgram descriptor={descriptor} api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: /Dictation: 7 words/ }));
    await screen.findByRole('button', { name: '가방' });
    expect(api.open).toHaveBeenCalledTimes(1);
    expect(api.dictation).toHaveBeenCalledWith('s1', { userId: 'test-learner' });
    expect(screen.getByRole('button', { name: /Listen/ })).toBeInTheDocument();
    expect(logs.dictationStarted).toHaveBeenCalledWith(expect.objectContaining({ from: 'start', week: '2026-W46', remaining: 7 }));
  });
});

describe('CardLadderProgram — weekly dictation: the run', () => {
  async function startRun(api) {
    render(<CardLadderProgram descriptor={descriptor} api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: /Dictation: 7 words/ }));
  }

  it('the header says which word of ten, never the word itself, and offers Stop for now', async () => {
    const api = fakeApi({ first: blind });
    await startRun(api);
    await screen.findByLabelText('Your answer');
    expect(screen.getByText(/Word 4 of 10/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('가위');
    fireEvent.click(screen.getByRole('button', { name: /Stop for now/ }));
    await waitFor(() => expect(api.respond).toHaveBeenCalledWith('s1', expect.objectContaining({ itemId: 'dc1:2', response: { stop: true } })));
    expect(logs.dictationExited).toHaveBeenCalledWith(expect.objectContaining({ reason: 'stop', week: '2026-W46' }));
  });

  it('the copy step plays the word from the item\'s own audio (Hear it), even with no word media', async () => {
    await startRun(fakeApi({ first: copy }));
    await settledField();
    expect(screen.getByRole('button', { name: /Hear it/ })).toBeInTheDocument();
  });

  it('a copy miss says "Not quite — let\'s look at it again" and waits for Next before the re-served item', async () => {
    const api = fakeApi({ first: copy, respondWith: async () => ({ ok: true, status: 200, data: { result: { correct: false }, item: pickAgain, progress: dictationProgress } }) });
    await startRun(api);
    const field = await settledField();
    fireEvent.change(field, { target: { value: '가우' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(await screen.findByText("Not quite — let's look at it again")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '가방' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await screen.findByRole('button', { name: '가방' });
    expect(logs.dictationAttempt).toHaveBeenCalledWith(expect.objectContaining({ wordId: 'gawi', step: 'copy', correct: false }));
  });

  it('a blind miss never shows the answer, before or after', async () => {
    const api = fakeApi({ first: blind, respondWith: async () => ({ ok: true, status: 200, data: { result: { correct: false, answer: null }, item: { ...copy, id: 'dc1:4' }, progress: dictationProgress } }) });
    await startRun(api);
    const field = await settledField();
    expect(document.body.textContent).not.toContain('가위');
    fireEvent.change(field, { target: { value: '거미' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(await screen.findByText("Not quite — let's look at it again")).toBeInTheDocument();
    expect(screen.queryByText(/The answer/)).toBeNull();
    expect(document.body.textContent).not.toContain('가위');
  });

  it('the keypad is open on the first typed dictation item, with no wait (touch-only Portal)', async () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn((query) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    try {
      await startRun(fakeApi({ first: copy }));
      await settledField();
      expect(screen.getByTestId('jamo-keypad')).toBeInTheDocument();
    } finally { window.matchMedia = original; }
  });

  it('with a keyboard known, the keypad toggle still shows in dictation (a dozing BLE keyboard never locks him out)', async () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn((query) => ({ matches: query === '(pointer: fine)', media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    try {
      await startRun(fakeApi({ first: blind }));
      await settledField();
      expect(screen.queryByTestId('jamo-keypad')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Show keypad' }));
      expect(await screen.findByTestId('jamo-keypad')).toBeInTheDocument();
    } finally { window.matchMedia = original; }
  });

  it('the ending renders "Dictation ready ✓"; Done acknowledges it and goes back to the ladder', async () => {
    const api = fakeApi({ first: ready, respondWith: async () => ({ ok: true, status: 200, data: { result: { done: true }, item: summary, progress } }) });
    await startRun(api);
    expect(await screen.findByText(/Dictation ready ✓/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Done/ }));
    await waitFor(() => expect(api.respond).toHaveBeenCalledWith('s1', expect.objectContaining({ itemId: 'dc1:ready', response: { done: true } })));
  });

  it('an ending with words waiting for a recording says so instead of "ready"', async () => {
    await startRun(fakeApi({ first: { ...ready, ready: false, wordsDone: 9, needsRecording: ['ima'] } }));
    expect(await screen.findByText(/needs its recording/)).toBeInTheDocument();
    expect(screen.queryByText(/Dictation ready ✓/)).toBeNull();
  });

  it('a list re-tagged mid-run restarts the run instead of dropping the answer silently', async () => {
    const api = fakeApi({ first: pick, respondWith: async () => ({ ok: true, status: 200, data: { result: null, item: pickAgain, progress: dictationProgress, dictation: { replaced: true, week: '2026-W47' } } }) });
    await startRun(api);
    fireEvent.click(await screen.findByRole('button', { name: '가방' }));
    await waitFor(() => expect(api.dictation).toHaveBeenCalledTimes(2));
  });
});

describe('CardLadderProgram — weekly dictation: the day-done card (after the flashcards)', () => {
  it('puts "Dictation: 7 words" above Done and starts in the same sitting', async () => {
    const api = fakeApi({ openItem: summary });
    render(<CardLadderProgram descriptor={descriptor} api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Start/ }));
    const card = await screen.findByRole('region', { name: 'Done' });
    const button = within(card).getByRole('button', { name: /Dictation: 7 words/ });
    fireEvent.click(button);
    await screen.findByRole('button', { name: '가방' });
    expect(api.open).toHaveBeenCalledTimes(1);
    expect(api.dictation).toHaveBeenCalledWith('s1', { userId: 'test-learner' });
    expect(logs.dictationStarted).toHaveBeenCalledWith(expect.objectContaining({ from: 'summary' }));
  });

  it('when the week is ready, the day-done card says so and Done stays the main button', async () => {
    render(<CardLadderProgram descriptor={descriptor} api={fakeApi({ openItem: summary, dictation: week({ remaining: 0, done: true, ready: true }) })} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Start/ }));
    const card = await screen.findByRole('region', { name: 'Done' });
    expect(within(card).getByText(/Dictation ready ✓/)).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /Dictation: / })).toBeNull();
  });
});

describe('CardLadderProgram — weekly dictation: the practice menu', () => {
  it('lists "Dictation: 7 words" and starts it in the sitting', async () => {
    const menu = { id: 'menu', type: 'menu', learnMore: 0, modes: ['flashcards'] };
    const api = fakeApi({ openItem: menu });
    api.words = vi.fn(async () => ({ ok: true, status: 200, data: { words: [] } }));
    render(<CardLadderProgram descriptor={descriptor} api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Start/ }));
    await screen.findByRole('heading', { name: 'Practice' });
    fireEvent.click(screen.getByRole('button', { name: /Dictation: 7 words/ }));
    await screen.findByRole('button', { name: '가방' });
    expect(api.dictation).toHaveBeenCalledWith('s1', { userId: 'test-learner' });
    expect(logs.dictationStarted).toHaveBeenCalledWith(expect.objectContaining({ from: 'menu' }));
  });
});

describe('CardLadderProgram — weekly dictation: final review fixes', () => {
  it('the start-card tap never shows the sitting\'s first regular card before the drill (I1)', async () => {
    let release;
    const api = fakeApi({ openItem: summary });
    api.dictation = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    render(<CardLadderProgram descriptor={descriptor} api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: /Dictation: 7 words/ }));
    await waitFor(() => expect(api.dictation).toHaveBeenCalled());
    expect(screen.queryByText(/You practised/)).toBeNull();
    release({ ok: true, status: 200, data: { item: pick, progress: dictationProgress, dictation: week() } });
    await screen.findByRole('button', { name: '가방' });
    expect(screen.queryByText(/You practised/)).toBeNull();
  });

  it('if the dictation call fails after opening, the child gets the sitting\'s own card, never a dead Loading (I1)', async () => {
    const api = fakeApi({ openItem: flash });
    api.dictation = vi.fn(async () => ({ ok: false, status: 500, data: { error: 'boom' } }));
    render(<CardLadderProgram descriptor={descriptor} api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: /Dictation: 7 words/ }));
    expect(await screen.findByText('가위')).toBeInTheDocument();
  });

  it('a finished week offers Review on the start card; it asks the server for a review run (I2)', async () => {
    const api = fakeApi({ dictation: week({ remaining: 0, done: true, ready: true }), first: blind });
    render(<CardLadderProgram descriptor={descriptor} api={api} />);
    expect(await screen.findByText(/Dictation ready ✓/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Review dictation/ }));
    await screen.findByLabelText('Your answer');
    expect(api.dictation).toHaveBeenCalledWith('s1', { userId: 'test-learner', review: true });
  });

  it('a finished week offers Review on the day-done card too (I2)', async () => {
    const api = fakeApi({ openItem: summary, dictation: week({ remaining: 0, done: true, ready: true }), first: blind });
    render(<CardLadderProgram descriptor={descriptor} api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Start/ }));
    const card = await screen.findByRole('region', { name: 'Done' });
    fireEvent.click(within(card).getByRole('button', { name: /Review dictation/ }));
    await waitFor(() => expect(api.dictation).toHaveBeenCalledWith('s1', { userId: 'test-learner', review: true }));
  });

  it('words left only for a grown-up are said, never hidden (I3)', async () => {
    render(<CardLadderProgram descriptor={descriptor} api={fakeApi({ dictation: week({ remaining: 0, done: false, ready: false, needsRecording: ['ima'] }) })} />);
    expect(await screen.findByText('Dictation: 1 word waiting for a grown-up')).toBeInTheDocument();
  });

  it('D on the start card starts the dictation (M7)', async () => {
    const api = fakeApi();
    render(<CardLadderProgram descriptor={descriptor} api={api} />);
    await screen.findByRole('button', { name: /Dictation: 7 words/ });
    fireEvent.keyDown(window, { key: 'd' });
    await waitFor(() => expect(api.dictation).toHaveBeenCalled());
  });

  it('the copy step\'s give-up reads "Don\'t know" — it steps the word back, it does not skip (M9)', async () => {
    await startRunFrom(fakeApi({ first: copy }));
    await settledField();
    expect(screen.getByRole('button', { name: /Don't know/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Skip/ })).toBeNull();
  });

  it('the ending counts the whole week and names no ids to the child (M6)', async () => {
    await startRunFrom(fakeApi({ first: { ...ready, ready: false, wordCount: 9, wordsDone: 9, needsRecording: ['ima'] } }));
    expect(await screen.findByText('9 of 10 words done')).toBeInTheDocument();
    expect(screen.queryByText('ima')).toBeNull();
  });
});

async function startRunFrom(api) {
  render(<CardLadderProgram descriptor={descriptor} api={api} />);
  fireEvent.click(await screen.findByRole('button', { name: /Dictation: 7 words/ }));
}

describe('CardLadderProgram — weekly dictation: deferred minors', () => {
  it('a correct copy is held with "That\'s it!" and Next, like the blind step (M4)', async () => {
    await startRunFrom(fakeApi({ first: copy, respondWith: async () => ({ ok: true, status: 200, data: { result: { correct: true }, item: blind, progress: dictationProgress } }) }));
    const field = await settledField();
    fireEvent.change(field, { target: { value: '가위' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(await screen.findByText("That's it!")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.queryByText("That's it!")).toBeNull());
  });

  it('a list whose tags were removed mid-run says so instead of restarting into an error (M5)', async () => {
    const api = fakeApi({ first: pick, respondWith: async () => ({ ok: true, status: 200, data: { result: null, item: flash, progress, dictation: { replaced: true, week: null } } }) });
    await startRunFrom(api);
    fireEvent.click(await screen.findByRole('button', { name: '가방' }));
    expect(await screen.findByText("This week's dictation list changed.")).toBeInTheDocument();
    expect(api.dictation).toHaveBeenCalledTimes(1);
  });

  it('the header fills the dots of the words that are done, and hides the time bar (M8)', async () => {
    await startRunFrom(fakeApi({ first: { ...pick, wordsDoneFlags: [false, true, false, false, false, false, false, false, false, true], wordsDone: 2, wordIndex: 1 } }));
    await screen.findByRole('button', { name: '가방' });
    const dots = [...document.querySelectorAll('.wl-dictation-dot')];
    expect(dots.map((d) => d.classList.contains('is-done'))).toEqual([false, true, false, false, false, false, false, false, false, true]);
    expect(document.querySelector('.wl-header__time')).toBeNull();
  });

  it('a dictation that cannot start says so (M10)', async () => {
    const api = fakeApi({ openItem: flash });
    api.dictation = vi.fn(async () => ({ ok: false, status: 500, data: { error: 'boom' } }));
    render(<CardLadderProgram descriptor={descriptor} api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: /Dictation: 7 words/ }));
    expect(await screen.findByText("Dictation couldn't start. Tap it again in a moment.")).toBeInTheDocument();
  });
});

describe('CardLadderProgram — always available (owner 2026-11-06)', () => {
  const menu = { id: 'menu', type: 'menu', learnMore: 0, modes: ['flashcards', 'match'], sayHelp: [], writeHelp: [true] };
  it('the start card always offers Review flashcards, before the goal too, and it opens the practice menu', async () => {
    const api = fakeApi({ dictation: null });
    api.menu = vi.fn(async () => ({ ok: true, status: 200, data: { item: menu, progress } }));
    api.words = vi.fn(async () => ({ ok: true, status: 200, data: { words: [] } }));
    render(<CardLadderProgram descriptor={descriptor} api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: /Review flashcards/ }));
    await screen.findByRole('heading', { name: 'Practice' });
    expect(api.open).toHaveBeenCalledTimes(1);
    expect(api.menu).toHaveBeenCalledWith('s1', { userId: 'test-learner' });
    expect(screen.queryByText('가위')).toBeNull();
  });
  it('Done on a menu opened before the goal goes back to today\'s cards instead of leaving', async () => {
    const api = fakeApi({ dictation: null });
    api.menu = vi.fn(async () => ({ ok: true, status: 200, data: { item: menu, progress } }));
    api.get = vi.fn(async () => ({ ok: true, status: 200, data: { item: flash, progress } }));
    api.words = vi.fn(async () => ({ ok: true, status: 200, data: { words: [] } }));
    const onExit = vi.fn();
    render(<CardLadderProgram descriptor={descriptor} api={api} onExit={onExit} />);
    fireEvent.click(await screen.findByRole('button', { name: /Review flashcards/ }));
    await screen.findByRole('heading', { name: 'Practice' });
    fireEvent.click(screen.getByRole('button', { name: /^Done/ }));
    expect(await screen.findByText('가위')).toBeInTheDocument();
    expect(onExit).not.toHaveBeenCalled();
    expect(api.close).not.toHaveBeenCalled();
  });
  it('the start card offers all three whatever the day: Start, Dictation, Review flashcards', async () => {
    render(<CardLadderProgram descriptor={descriptor} api={fakeApi()} />);
    await screen.findByRole('button', { name: /Dictation: 7 words/ });
    expect(screen.getByRole('button', { name: /^Start/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Review flashcards/ })).toBeInTheDocument();
  });
});
