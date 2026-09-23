import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FlashcardItem from './FlashcardItem.jsx';
import ChoiceItem from './ChoiceItem.jsx';
import ListenItem from './ListenItem.jsx';
import MatchItem from './MatchItem.jsx';
import SummaryItem from './SummaryItem.jsx';
import TypedItem from './TypedItem.jsx';
import SayItem from './SayItem.jsx';
import MenuItem from './MenuItem.jsx';
import WordsItem from './WordsItem.jsx';

// Owner rulings 2026-09-23: outside typing, Enter mirrors Space on every item
// and never skips; inside a typing field Space types a space (Korean phrases
// have them) and Enter submits, then goes Next. Every action a child needs to
// move forward has a key — the one deliberately touch-first action is Skip
// (and even that has the hunted-for Backslash).
vi.mock('../cardLadderAudio.js', () => ({
  playClip: vi.fn(async () => true),
  playSequence: vi.fn(async () => {}),
  startClip: vi.fn(() => ({ done: Promise.resolve(), stop: vi.fn() })),
}));
const recorder = vi.hoisted(() => ({ phase: 'idle', start: null, stop: null }));
vi.mock('../useTakeRecorder.js', () => ({
  default: vi.fn(() => ({ start: recorder.start, stop: recorder.stop, phase: recorder.phase, verdict: null, stream: null, onLevel: vi.fn(), unavailable: false })),
}));
vi.mock('../../../../../../hooks/useHardwareKeyboard.js', () => ({ useHardwareKeyboard: () => false, default: () => false }));

const langs = { target: 'ko', anchor: 'en', targetScript: 'hangul' };
const id = (x) => x;
const word = { wordId: 'gawi', term: '가위', gloss: 'Scissors', pronunciation: null, kind: 'word', media: { image: null, audio: 'aud', glossAudio: null } };
const enter = (target = window) => fireEvent.keyDown(target, { key: 'Enter', code: 'Enter' });
const space = (target = window) => fireEvent.keyDown(target, { key: ' ', code: 'Space' });

describe('Enter mirrors Space outside typing', () => {
  it('flashcard: Enter flips, then Enter goes Next', () => {
    const onRespond = vi.fn();
    render(<FlashcardItem item={{ id: 'f1', type: 'flashcard', mode: 'intro', word }} langs={langs} resolveAssetUrl={id} onRespond={onRespond} />);
    enter();
    expect(screen.getByRole('button', { name: /flip back/i })).toHaveClass('is-flipped');
    enter();
    expect(onRespond).toHaveBeenCalledWith({ seen: true });
  });

  it('choice after a result: Enter continues', () => {
    const onContinue = vi.fn();
    render(<ChoiceItem item={{ id: 'q1', type: 'choice', task: '2.2', channel: 'read', prompt: '가위', choices: ['Glue', 'Scissors'], assets: {} }} langs={langs} resolveAssetUrl={id} onRespond={vi.fn()} result={{ correct: true, answer: 'Scissors' }} onContinue={onContinue} />);
    enter();
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('say: Enter records before a take, stops while recording, goes Next after', async () => {
    recorder.start = vi.fn(async () => {}); recorder.stop = vi.fn(); recorder.phase = 'idle';
    const onRespond = vi.fn();
    const item = { id: 's1', type: 'say', mode: 'read-aloud', word: { wordId: 'gawi', term: '가위', media: { audio: null } } };
    const props = { item, mode: 'read-aloud', langs, resolveAssetUrl: id, onRespond, api: { uploadRecording: vi.fn(async () => ({ ok: true, status: 200, data: {} })) }, sittingId: 's', userId: 'kid' };
    const { rerender } = render(<SayItem {...props} />);
    enter();
    expect(recorder.start).toHaveBeenCalledTimes(1);
    recorder.phase = 'recording';
    rerender(<SayItem {...props} />);
    enter();
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(onRespond).not.toHaveBeenCalled();
    recorder.phase = 'idle';
    rerender(<SayItem {...props} />);
    const { default: useTakeRecorder } = await import('../useTakeRecorder.js');
    const { onTake } = useTakeRecorder.mock.calls.at(-1)[0];
    window.URL.createObjectURL = vi.fn(() => 'blob:x'); window.URL.revokeObjectURL = vi.fn();
    await act(async () => { await onTake({ blob: new Blob(['x']), durationMs: 2000 }); });
    enter();
    expect(onRespond).toHaveBeenCalledWith({ done: true });
  });

  it('listen: Enter goes Next', () => {
    const onRespond = vi.fn();
    render(<ListenItem item={{ id: 'l1', type: 'listen', words: [{ wordId: 'gawi', term: '가위', audio: 'a1' }] }} langs={langs} resolveAssetUrl={id} onRespond={onRespond} />);
    enter();
    expect(onRespond).toHaveBeenCalledWith({ done: true });
  });

  it('match: Enter finishes a completed board', () => {
    const onRespond = vi.fn();
    const board = { pairs: [{ wordId: 'gawi', term: '가위', right: { type: 'text', text: 'Scissors' } }, { wordId: 'pul', term: '풀', right: { type: 'text', text: 'Glue' } }] };
    render(<MatchItem item={{ id: 'm1', type: 'match', board }} langs={langs} resolveAssetUrl={id} onRespond={onRespond} />);
    for (const pair of board.pairs) {
      fireEvent.click(within(screen.getByRole('group', { name: 'Words' })).getByText(pair.term));
      fireEvent.click(within(screen.getByRole('group', { name: 'Meanings' })).getByText(pair.right.text));
    }
    enter();
    expect(onRespond).toHaveBeenCalledWith({ done: true });
  });

  it('summary: Enter is Done', () => {
    const onExit = vi.fn();
    render(<SummaryItem item={{ quizzed: 2 }} onExit={onExit} onRespond={vi.fn()} />);
    enter();
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});

describe('typing items: Space types, Enter submits then advances', () => {
  const cueItem = { id: 't1', type: 'typed', task: '3.3', cue: { type: 'text', text: 'Goodbye' }, assets: {} };

  it('Space in the field never advances; Enter submits the phrase with its space', () => {
    const onRespond = vi.fn();
    const onContinue = vi.fn();
    render(<TypedItem item={cueItem} mode="graded" langs={langs} resolveAssetUrl={id} onRespond={onRespond} onContinue={onContinue} />);
    const input = screen.getByRole('textbox', { name: /your answer/i });
    fireEvent.change(input, { target: { value: '안녕히' } });
    expect(space(input)).toBe(true); // not prevented: the browser types the space
    fireEvent.change(input, { target: { value: '안녕히 계세요' } });
    expect(onRespond).not.toHaveBeenCalled();
    expect(onContinue).not.toHaveBeenCalled();
    enter(input);
    expect(onRespond).toHaveBeenCalledWith({ typed: '안녕히 계세요' });
  });

  it('once graded, Enter (and Space) go Next', () => {
    const onContinue = vi.fn();
    render(<TypedItem item={cueItem} mode="graded" langs={langs} resolveAssetUrl={id} onRespond={vi.fn()} onContinue={onContinue} result={{ correct: true, score: 10, answer: '안녕히 계세요' }} />);
    enter();
    expect(onContinue).toHaveBeenCalledTimes(1);
    space();
    expect(onContinue).toHaveBeenCalledTimes(2);
  });

  it('Show me has a key: Backslash, from the field or the page', () => {
    const onRespond = vi.fn();
    render(<TypedItem item={cueItem} mode="practice" langs={langs} resolveAssetUrl={id} onRespond={onRespond} />);
    expect(screen.getByRole('button', { name: 'Show me' }).querySelector('.ds-touch__key')).toHaveTextContent('\\');
    fireEvent.keyDown(screen.getByRole('textbox', { name: /your answer/i }), { key: '\\', code: 'Backslash' });
    expect(onRespond).toHaveBeenCalledWith({ typed: '' });
  });
});

describe('menus: every action has a key', () => {
  const api = () => ({
    practice: vi.fn(async () => ({ ok: true, status: 200, data: { item: null, progress: null } })),
    words: vi.fn(async () => ({ ok: true, status: 200, data: { words: [
      { wordId: 'gawi', term: '가위', gloss: 'Scissors', state: 'familiar', stage: 0 },
      { wordId: 'chaek', term: '책', gloss: 'Book', state: 'claimed', stage: 0 },
    ] } })),
  });
  const menu = (extra = {}) => ({ item: { id: 'menu', type: 'menu', modes: ['match', 'flashcards'] }, api: api(), sittingId: 's', userId: 'kid', deckId: 'd', langs, onPractice: vi.fn(), onExit: vi.fn(), ...extra });

  it('menu: Space/Enter is Done; the digit after the modes opens My words', async () => {
    const props = menu();
    render(<MenuItem {...props} />);
    enter();
    expect(props.onExit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /my words/i }).querySelector('.ds-touch__key')).toHaveTextContent('3');
    fireEvent.keyDown(window, { key: '3', code: 'Digit3' });
    expect(await screen.findByRole('region', { name: 'My words' })).toBeInTheDocument();
  });

  it('Write Without help stays locked, with a kid-readable note, until a word is ready (no key either)', () => {
    const props = menu({ item: { id: 'menu', type: 'menu', modes: ['write'], writeHelp: [true] } });
    render(<MenuItem {...props} />);
    fireEvent.keyDown(window, { key: '1', code: 'Digit1' }); // Write → With help / Without help
    expect(screen.getByRole('button', { name: /with help/i })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /without help/i })).toBeDisabled();
    expect(screen.getByText('Unlocks when a word is ready')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: '2', code: 'Digit2' });
    expect(props.api.practice).not.toHaveBeenCalled();
  });

  it('a sub-menu goes Back on Backspace', () => {
    render(<MenuItem {...menu()} />);
    fireEvent.keyDown(window, { key: '2', code: 'Digit2' }); // flashcards → which side first?
    expect(screen.getByText(/which side first/i)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Backspace', code: 'Backspace' });
    expect(screen.getByRole('heading', { name: 'Practice' })).toBeInTheDocument();
  });

  it('word picker: arrows move, Space toggles, Enter drills, Backspace goes back', async () => {
    const onDrill = vi.fn();
    const onBack = vi.fn();
    render(<WordsItem api={api()} sittingId="s" userId="kid" deckId="d" langs={langs} pick onDrill={onDrill} onBack={onBack} />);
    await screen.findByText('책');
    fireEvent.keyDown(window, { key: 'ArrowRight', code: 'ArrowRight' });
    space();
    expect(screen.getByRole('button', { name: /책/ })).toHaveAttribute('aria-pressed', 'true');
    enter();
    expect(onDrill).toHaveBeenCalledWith(['chaek']);
    fireEvent.keyDown(window, { key: 'Backspace', code: 'Backspace' });
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
