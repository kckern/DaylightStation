import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FlashcardItem from './FlashcardItem.jsx';
import ChoiceItem from './ChoiceItem.jsx';
import ListenItem from './ListenItem.jsx';
import TypedItem from './TypedItem.jsx';
import DrillItem from './DrillItem.jsx';
import DrillOfferItem from './DrillOfferItem.jsx';
import { playClip, startClip } from '../wordLadderAudio.js';

// The owner's key map: Space always moves forward, Tab is "hear it again"
// everywhere there is audio, and a skip is a touch (or a hunted-for `\`).
vi.mock('../wordLadderAudio.js', () => ({
  playClip: vi.fn(async () => true),
  playSequence: vi.fn(async () => {}),
  // A clip that ends at once, so a Listen run finishes and Again can replay it.
  startClip: vi.fn(() => ({ done: Promise.resolve(), stop: vi.fn() })),
}));
vi.mock('../useTakeRecorder.js', () => ({
  default: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), phase: 'idle', verdict: null, stream: null, onLevel: vi.fn(), unavailable: false })),
}));

const langs = { term: 'ko', gloss: 'en' };
const id = (x) => x;
const word = { wordId: 'gawi', term: '가위', gloss: 'Scissors', pronunciation: null, kind: 'word', media: { image: 'img', audio: 'aud', glossAudio: null } };
const tab = (target = window) => fireEvent.keyDown(target, { key: 'Tab', code: 'Tab' });
const hint = (name) => screen.getByRole('button', { name }).querySelector('.ds-touch__key')?.textContent;

afterEach(() => { playClip.mockClear(); startClip.mockClear(); });

describe('Tab = hear it again', () => {
  it('flashcard: Tab replays the term, is prevented (focus stays), and the button hints Tab', () => {
    render(<FlashcardItem item={{ id: 'f1', type: 'flashcard', mode: 'intro', word }} langs={langs} resolveAssetUrl={id} onRespond={vi.fn()} />);
    playClip.mockClear();
    expect(tab()).toBe(false); // preventDefault → the browser never moves focus
    expect(playClip).toHaveBeenCalledWith('aud', 'term');
    expect(hint(/hear it/i)).toBe('Tab');
  });

  it('choice (hear): Tab plays the prompt audio; Listen hints Tab', () => {
    const item = { id: 'q1', type: 'choice', task: '2.2', channel: 'hear', prompt: '가위', choices: ['Glue', 'Scissors'], assets: { audio: 'aud-gawi' } };
    render(<ChoiceItem item={item} langs={langs} resolveAssetUrl={id} onRespond={vi.fn()} />);
    playClip.mockClear();
    expect(tab()).toBe(false);
    expect(playClip).toHaveBeenCalledWith('aud-gawi', 'term');
    expect(hint(/listen/i)).toBe('Tab');
  });

  it('choice (3.1 audio cue): Tab plays the gloss audio; Listen hints Tab', () => {
    const item = { id: 'q2', type: 'choice', task: '3.1', cue: { type: 'audio' }, choices: ['가위', '풀'], assets: { glossAudio: 'g-aud' } };
    render(<ChoiceItem item={item} langs={langs} resolveAssetUrl={id} onRespond={vi.fn()} />);
    playClip.mockClear();
    tab();
    expect(playClip).toHaveBeenCalledWith('g-aud', 'gloss');
    expect(hint(/listen/i)).toBe('Tab');
  });

  it('listen: Tab replays the run once it has finished; Again hints Tab', async () => {
    render(<ListenItem item={{ id: 'l1', type: 'listen', words: [{ wordId: 'gawi', term: '가위', audio: 'a1' }] }} langs={langs} resolveAssetUrl={id} onRespond={vi.fn()} />);
    await act(async () => {});
    startClip.mockClear();
    expect(tab()).toBe(false);
    await act(async () => {});
    expect(startClip).toHaveBeenCalledWith('a1', 'term');
    expect(hint(/again/i)).toBe('Tab');
  });

  it('typed (copy): Tab in the focused field plays, inserts nothing, keeps focus', () => {
    render(<TypedItem item={{ id: 't1', type: 'typed', word }} mode="copy" langs={langs} resolveAssetUrl={id} onRespond={vi.fn()} />);
    const input = screen.getByRole('textbox', { name: /your answer/i });
    input.focus();
    playClip.mockClear();
    expect(tab(input)).toBe(false);
    expect(playClip).toHaveBeenCalledWith('aud', 'term');
    expect(document.activeElement).toBe(input);
    expect(input).toHaveValue('');
    expect(hint(/hear it/i)).toBe('Tab');
  });

  it('typed (dictation): Tab in the field plays the dictation audio; Listen hints Tab', () => {
    render(<TypedItem item={{ id: 't2', type: 'drill', assets: { audio: 'd-aud' } }} mode="dictation" langs={langs} resolveAssetUrl={id} onRespond={vi.fn()} />);
    const input = screen.getByRole('textbox', { name: /your answer/i });
    input.focus();
    playClip.mockClear();
    expect(tab(input)).toBe(false);
    expect(playClip).toHaveBeenCalledWith('d-aud', 'term');
    expect(hint(/listen/i)).toBe('Tab');
  });

  it('typed: H typed into the field is never a hear-it command (Korean IME: H is ㅗ)', () => {
    render(<TypedItem item={{ id: 't3', type: 'typed', word }} mode="copy" langs={langs} resolveAssetUrl={id} onRespond={vi.fn()} />);
    const input = screen.getByRole('textbox', { name: /your answer/i });
    playClip.mockClear();
    fireEvent.keyDown(input, { key: 'ㅗ', code: 'KeyH' });
    expect(playClip).not.toHaveBeenCalled();
  });

  it('drill look + drill offer: Tab plays the term and hints Tab', () => {
    const { unmount } = render(<DrillItem item={{ id: 'd1', type: 'drill', step: 'look', word, of: 3, at: 1 }} langs={langs} resolveAssetUrl={id} onRespond={vi.fn()} />);
    playClip.mockClear();
    tab();
    expect(playClip).toHaveBeenCalledWith('aud', 'term');
    expect(hint(/hear it/i)).toBe('Tab');
    unmount();
    render(<DrillOfferItem item={{ id: 'o1', type: 'drillOffer', word }} langs={langs} resolveAssetUrl={id} onRespond={vi.fn()} />);
    playClip.mockClear();
    tab();
    expect(playClip).toHaveBeenCalledWith('aud', 'term');
    expect(hint(/hear it/i)).toBe('Tab');
  });

  it('H still works as a silent alias on a non-typing item', () => {
    render(<FlashcardItem item={{ id: 'f2', type: 'flashcard', mode: 'intro', word }} langs={langs} resolveAssetUrl={id} onRespond={vi.fn()} />);
    playClip.mockClear();
    fireEvent.keyDown(window, { key: 'h', code: 'KeyH' });
    expect(playClip).toHaveBeenCalledWith('aud', 'term');
  });
});

describe('DrillItem fallback', () => {
  it('an unknown step says Continue (never Skip), and Space advances', () => {
    const onRespond = vi.fn();
    render(<DrillItem item={{ id: 'd9', type: 'drill', step: 'future-step', of: 9, at: 9 }} langs={langs} resolveAssetUrl={id} onRespond={onRespond} />);
    expect(screen.queryByRole('button', { name: /skip/i })).toBeNull();
    expect(hint(/continue/i)).toBe('Space');
    fireEvent.keyDown(window, { key: ' ', code: 'Space' });
    expect(onRespond).toHaveBeenCalledWith({ done: true });
  });
});
