import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FlashcardItem from './FlashcardItem.jsx';
import ChoiceItem from './ChoiceItem.jsx';
import TypedItem from './TypedItem.jsx';
import SummaryItem from './SummaryItem.jsx';
import { playClip } from '../wordLadderAudio.js';
import { wordLadderLog } from '../wordLadderLog.js';
import { modeForLanguage } from '../../../../ime/languages.js';
import HangulTypingProvider from '../../../../ime/HangulTypingProvider.jsx';

vi.mock('../wordLadderAudio.js', () => ({ playClip: vi.fn(async () => true) }));
// The keyboard-presence signal is module state that a keydown in one test
// would leak into the next; these tests are about the keypad itself, so the
// device is a touch panel with no keyboard known (see keypadToggle.test.jsx
// for the detection itself).
vi.mock('../../../../../../hooks/useHardwareKeyboard.js', () => ({ useHardwareKeyboard: () => false, default: () => false }));
const word = { wordId: 'gawi', term: '가위', gloss: 'Scissors', pronunciation: null, kind: 'word', media: { image: 'img', audio: 'aud', glossAudio: null } };
const langs = { term: 'ko', gloss: 'en' };

describe('FlashcardItem', () => {
  it('front shows only the Korean; Space flips to picture + gloss; 3 sorts Got it', () => {
    const onRespond = vi.fn();
    render(<FlashcardItem item={{ id: 'r1:s:0', type: 'flashcard', mode: 'stream', word }} langs={langs} resolveAssetUrl={(x) => x} onRespond={onRespond} />);
    expect(screen.getByText('가위')).toBeInTheDocument();
    // Both faces are mounted for the 3D flip; the back is hidden from sight and the reader.
    expect(screen.getByText('Scissors').closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
    fireEvent.keyDown(window, { key: ' ' });
    expect(screen.getByText('Scissors').closest('[aria-hidden="true"]')).toBeNull();
    expect(screen.getByRole('img')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: '3' });
    expect(onRespond).toHaveBeenCalledWith({ sort: 'claimed' });
  });

  it('intro mode Next sends only {seen:true}, never sort flags', () => {
    const onRespond = vi.fn();
    render(<FlashcardItem item={{ id: 'r1:i:0', type: 'flashcard', mode: 'intro', word }} langs={langs} resolveAssetUrl={(x) => x} onRespond={onRespond} />);
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith({ seen: true });
  });

  it('logs card.flipped on flip, card.sorted with the pile on a sort, and card.undone on Undo', () => {
    const flipped = vi.spyOn(wordLadderLog, 'cardFlipped').mockImplementation(() => {});
    const sorted = vi.spyOn(wordLadderLog, 'cardSorted').mockImplementation(() => {});
    const undone = vi.spyOn(wordLadderLog, 'cardUndone').mockImplementation(() => {});
    const onRespond = vi.fn();
    render(<FlashcardItem item={{ id: 'r1:s:1', type: 'flashcard', mode: 'stream', word }} langs={langs} resolveAssetUrl={(x) => x} onRespond={onRespond} />);
    fireEvent.keyDown(window, { key: ' ' }); // flip
    expect(flipped).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'r1:s:1', ms: expect.any(Number) }));
    fireEvent.keyDown(window, { key: '2' }); // sort familiar
    expect(sorted).toHaveBeenCalledWith({ itemId: 'r1:s:1', pile: 'familiar' });
    fireEvent.keyDown(window, { key: 'u' }); // undo
    expect(undone).toHaveBeenCalledWith({ itemId: 'r1:s:1' });
    flipped.mockRestore(); sorted.mockRestore(); undone.mockRestore();
  });
});

describe('ChoiceItem', () => {
  it("number keys pick a choice; 0 is Don't know", () => {
    const onRespond = vi.fn();
    render(<ChoiceItem item={{ id: 'q', type: 'choice', task: '2.2', channel: 'read', prompt: '가위', choices: ['Glue', 'Scissors', 'Book', 'Pen'], assets: {} }} langs={langs} resolveAssetUrl={(x) => x} onRespond={onRespond} />);
    fireEvent.keyDown(window, { key: '2' });
    expect(onRespond).toHaveBeenCalledWith({ choice: 'Scissors' });
    fireEvent.keyDown(window, { key: '0' });
    expect(onRespond).toHaveBeenCalledWith({ dontKnow: true });
  });

  it('never renders the hear-channel prompt (the term) until a result exists', () => {
    const onRespond = vi.fn();
    const { rerender } = render(
      <ChoiceItem item={{ id: 'q2', type: 'choice', task: '2.2', channel: 'hear', prompt: '가위', choices: ['Glue', 'Scissors', 'Book', 'Pen'], assets: { audio: 'aud' } }} langs={langs} resolveAssetUrl={(x) => x} onRespond={onRespond} />,
    );
    expect(screen.queryByText('가위')).toBeNull();
    rerender(
      <ChoiceItem item={{ id: 'q2', type: 'choice', task: '2.2', channel: 'hear', prompt: '가위', choices: ['Glue', 'Scissors', 'Book', 'Pen'], assets: { audio: 'aud' } }} langs={langs} resolveAssetUrl={(x) => x} onRespond={onRespond} result={{ correct: true, answer: 'Scissors' }} onContinue={() => {}} />,
    );
    expect(screen.getByText('가위')).toBeInTheDocument();
  });

  it('a wrong result autoplays the Korean audio once, and H replays it', () => {
    playClip.mockClear();
    const onRespond = vi.fn();
    const item = { id: 'q3', type: 'choice', task: '2.2', channel: 'read', prompt: '가위', choices: ['Glue', 'Scissors', 'Book', 'Pen'], assets: { audio: 'aud-gawi' } };
    render(<ChoiceItem item={item} langs={langs} resolveAssetUrl={(x) => x} onRespond={onRespond} result={{ correct: false, answer: 'Scissors' }} onContinue={() => {}} />);
    expect(playClip).toHaveBeenCalledTimes(1);
    expect(playClip).toHaveBeenCalledWith('aud-gawi', 'term');
    playClip.mockClear();
    fireEvent.keyDown(window, { key: 'h' });
    expect(playClip).toHaveBeenCalledWith('aud-gawi', 'term');
  });
});

describe('image cues', () => {
  const imageChoice = { id: 'p1', type: 'choice', task: '3.1', cue: { type: 'image', text: 'Scissors' }, choices: ['가위', '풀', '책', '펜'], assets: { image: 'img-gawi' } };
  const imageTyped = { id: 'p2', type: 'typed', task: '3.3', cue: { type: 'image', text: 'Scissors' }, assets: { image: 'img-gawi' } };

  it('ChoiceItem: an image that fails to load drops out (the text stays) and logs', () => {
    const spy = vi.spyOn(wordLadderLog, 'mediaFailed').mockImplementation(() => {});
    const { container } = render(<ChoiceItem item={imageChoice} langs={langs} resolveAssetUrl={(x) => x} onRespond={() => {}} />);
    const img = container.querySelector('img.wl-cue-picture');
    expect(img).not.toBeNull();
    // Ruling 2026-09-23: the English text shows WITH the picture, not only as its fallback.
    expect(screen.getByText('Scissors')).toBeInTheDocument();
    fireEvent.error(img);
    expect(container.querySelector('img.wl-cue-picture')).toBeNull();
    expect(screen.getByText('Scissors')).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ kind: 'image', itemId: 'p1' }));
    spy.mockRestore();
  });

  it('ChoiceItem: an image cue with no image asset renders the text cue', () => {
    const { container } = render(<ChoiceItem item={{ ...imageChoice, assets: {} }} langs={langs} resolveAssetUrl={(x) => x} onRespond={() => {}} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('Scissors')).toBeInTheDocument();
  });

  it('TypedItem: an image that fails to load falls back to the text cue and logs', () => {
    const spy = vi.spyOn(wordLadderLog, 'mediaFailed').mockImplementation(() => {});
    const { container } = render(<TypedItem item={imageTyped} mode="graded" langs={langs} resolveAssetUrl={(x) => x} onRespond={() => {}} />);
    const img = container.querySelector('img.wl-cue-picture');
    expect(img).not.toBeNull();
    fireEvent.error(img);
    expect(container.querySelector('img.wl-cue-picture')).toBeNull();
    expect(screen.getByText('Scissors')).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ kind: 'image', itemId: 'p2' }));
    spy.mockRestore();
  });

  it('TypedItem: an image cue with no image asset renders the text cue', () => {
    const { container } = render(<TypedItem item={{ ...imageTyped, assets: {} }} mode="graded" langs={langs} resolveAssetUrl={(x) => x} onRespond={() => {}} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('Scissors')).toBeInTheDocument();
  });
});

describe('TypedItem', () => {
  it('declares a language the in-page IME composes Korean for', () => {
    render(<TypedItem item={{ id: 't0', type: 'typed', task: '3.3', cue: { type: 'text', text: 'Scissors' }, assets: {} }} mode="graded" langs={langs} resolveAssetUrl={(x) => x} onRespond={() => {}} />);
    expect(modeForLanguage(screen.getByRole('textbox').dataset.imeLang)).toBe('KR');
  });

  it('a copy mismatch clears the field so the retry starts empty', () => {
    const { rerender } = render(<TypedItem item={{ id: 'c0', type: 'typed', word, assets: {} }} mode="copy" langs={langs} resolveAssetUrl={(x) => x} onRespond={() => {}} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '가우' } });
    expect(input.value).toBe('가우');
    rerender(<TypedItem item={{ id: 'c0', type: 'typed', word, assets: {} }} mode="copy" langs={langs} resolveAssetUrl={(x) => x} onRespond={() => {}} result={{ correct: false }} />);
    expect(input.value).toBe('');
  });

  it('Enter submits the typed answer and number keys do not leak from the field', () => {
    const onRespond = vi.fn();
    render(<TypedItem item={{ id: 't', type: 'typed', task: '3.3', cue: { type: 'text', text: 'Scissors' }, assets: {} }} mode="graded" langs={langs} resolveAssetUrl={(x) => x} onRespond={onRespond} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '가위' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRespond).toHaveBeenCalledWith({ typed: '가위' });
  });

  it('a graded 1.4 dictation sign-off plays the term audio on show, offers Listen, shows no cue, and submits for judging', () => {
    playClip.mockClear();
    const onRespond = vi.fn();
    render(<TypedItem item={{ id: 'rc:gawi', type: 'typed', task: '1.4', source: 'recheck', wordId: 'gawi', assets: { image: null, audio: 'aud', glossAudio: null } }} mode="graded" langs={langs} resolveAssetUrl={(x) => `u-${x}`} onRespond={onRespond} />);
    expect(playClip).toHaveBeenCalledWith('u-aud', 'term');
    expect(screen.getByRole('region', { name: 'Write what you hear' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Listen/ }));
    expect(playClip).toHaveBeenCalledTimes(2);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '가위' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRespond).toHaveBeenCalledWith({ typed: '가위' });
  });

  it('a copy mismatch keeps the on-screen Enter button visible for a retry', () => {
    const onRespond = vi.fn();
    render(<TypedItem item={{ id: 'c1', type: 'typed', word, assets: {} }} mode="copy" langs={langs} resolveAssetUrl={(x) => x} onRespond={onRespond} result={{ correct: false }} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '가위' } });
    const button = screen.getByRole('button', { name: 'Enter' });
    fireEvent.click(button);
    expect(onRespond).toHaveBeenCalledWith({ typed: '가위' });
  });
});

/**
 * THE KEYPAD TOGGLE (spec §6). A toggle, not a detector: the field auto-opens
 * it once per item after 10 s of idle focus, and a real keydown closes it —
 * proof that a physical keyboard just spoke, so the keypad has nothing left
 * to do here.
 */
describe('TypedItem keypad toggle', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('shows a small icon-only keypad toggle (no text), closed by default', () => {
    render(<TypedItem item={{ id: 'k0', type: 'typed', task: '3.3', cue: { type: 'text', text: 'Scissors' }, assets: {} }} mode="graded" langs={langs} resolveAssetUrl={(x) => x} onRespond={() => {}} />);
    const toggle = screen.getByRole('button', { name: 'Show Korean keypad' });
    expect(toggle).toHaveTextContent(/^$/);
    expect(toggle.querySelector('svg, .school-icon, [class*="icon"]')).not.toBeNull();
    expect(screen.queryByTestId('jamo-keypad')).toBeNull();
  });

  it('a click on the toggle opens the keypad, and a second click closes it', () => {
    render(<TypedItem item={{ id: 'k1', type: 'typed', task: '3.3', cue: { type: 'text', text: 'Scissors' }, assets: {} }} mode="graded" langs={langs} resolveAssetUrl={(x) => x} onRespond={() => {}} />);
    const toggle = screen.getByRole('button', { name: /korean keypad/i });
    fireEvent.click(toggle);
    expect(screen.getByTestId('jamo-keypad')).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByTestId('jamo-keypad')).toBeNull();
  });

  it('adds wl-typed--keypad to the item while the keypad is open, for the fit CSS (fix round 1)', () => {
    render(<TypedItem item={{ id: 'k1b', type: 'typed', task: '3.3', cue: { type: 'text', text: 'Scissors' }, assets: {} }} mode="graded" langs={langs} resolveAssetUrl={(x) => x} onRespond={() => {}} />);
    const section = screen.getByRole('region', { name: 'Type the word' });
    expect(section.className).not.toMatch('wl-typed--keypad');
    fireEvent.click(screen.getByRole('button', { name: /korean keypad/i }));
    expect(section.className).toMatch('wl-typed--keypad');
    fireEvent.click(screen.getByRole('button', { name: /korean keypad/i }));
    expect(section.className).not.toMatch('wl-typed--keypad');
  });

  it('auto-opens once after 10 s of idle focus, and logs keypad.toggled {auto:true}', () => {
    const spy = vi.spyOn(wordLadderLog, 'keypadToggled').mockImplementation(() => {});
    vi.useFakeTimers();
    render(<TypedItem item={{ id: 'k2', type: 'typed', task: '3.3', cue: { type: 'text', text: 'Scissors' }, assets: {} }} mode="graded" langs={langs} resolveAssetUrl={(x) => x} onRespond={() => {}} />);
    expect(screen.queryByTestId('jamo-keypad')).toBeNull();
    act(() => { vi.advanceTimersByTime(9999); });
    expect(screen.queryByTestId('jamo-keypad')).toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByTestId('jamo-keypad')).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith({ auto: true, open: true });
    spy.mockRestore();
  });

  it('closes on the first physical keydown in the field', () => {
    vi.useFakeTimers();
    render(<TypedItem item={{ id: 'k3', type: 'typed', task: '3.3', cue: { type: 'text', text: 'Scissors' }, assets: {} }} mode="graded" langs={langs} resolveAssetUrl={(x) => x} onRespond={() => {}} />);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.getByTestId('jamo-keypad')).toBeInTheDocument();
    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'a', code: 'KeyA' });
    expect(screen.queryByTestId('jamo-keypad')).toBeNull();
  });

  it('a physical keydown before 10 s cancels the auto-open — a keyboard is present', () => {
    vi.useFakeTimers();
    render(<TypedItem item={{ id: 'k4', type: 'typed', task: '3.3', cue: { type: 'text', text: 'Scissors' }, assets: {} }} mode="graded" langs={langs} resolveAssetUrl={(x) => x} onRespond={() => {}} />);
    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'a', code: 'KeyA' });
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.queryByTestId('jamo-keypad')).toBeNull();
  });

  it('a new item re-arms the auto-open and starts the keypad closed', () => {
    vi.useFakeTimers();
    const { rerender } = render(<TypedItem item={{ id: 'k5', type: 'typed', task: '3.3', cue: { type: 'text', text: 'Scissors' }, assets: {} }} mode="graded" langs={langs} resolveAssetUrl={(x) => x} onRespond={() => {}} />);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.getByTestId('jamo-keypad')).toBeInTheDocument();
    rerender(<TypedItem item={{ id: 'k6', type: 'typed', task: '3.3', cue: { type: 'text', text: 'Glue' }, assets: {} }} mode="graded" langs={langs} resolveAssetUrl={(x) => x} onRespond={() => {}} />);
    expect(screen.queryByTestId('jamo-keypad')).toBeNull();
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.getByTestId('jamo-keypad')).toBeInTheDocument();
  });

  // Fix round 1: the reviewer's repro. Hear it steals focus in the idle
  // window; without a refocus, the auto-opened keypad sits over a field that
  // isn't focused and every tap lands on nothing (offerJamo acts on
  // document.activeElement).
  it('Hear it moves focus away; auto-open still refocuses the field, and a keypad tap types into it (fix round 1)', () => {
    vi.useFakeTimers();
    render(
      <HangulTypingProvider>
        <TypedItem item={{ id: 'k7', type: 'typed', word, assets: {} }} mode="copy" langs={langs} resolveAssetUrl={(x) => x} onRespond={() => {}} />
      </HangulTypingProvider>,
    );
    const field = screen.getByRole('textbox');
    expect(document.activeElement).toBe(field); // mount already focused it
    const hearIt = screen.getByRole('button', { name: /Hear it/ });
    act(() => { hearIt.focus(); });
    expect(document.activeElement).toBe(hearIt);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.getByTestId('jamo-keypad')).toBeInTheDocument();
    expect(document.activeElement).toBe(field); // auto-open refocused it
    act(() => { fireEvent.pointerDown(document.querySelector('[data-jamo="ㄱ"]')); });
    expect(field.value).toBe('ㄱ');
  });

  it('does not auto-open over a busy (submitting) field, and does not steal focus — and it stays closed once busy clears', () => {
    // The render-time `open={keypadOpen && !fieldDisabled}` gate alone would
    // hide this WHILE busy, but if the internal `keypadOpen` boolean had
    // already flipped true underneath, the keypad would resurface the moment
    // busy clears, unasked. The fix must stop that flip from happening at
    // all — this is the assertion that actually distinguishes the two.
    vi.useFakeTimers();
    const props = { item: { id: 'k8', type: 'typed', task: '3.3', cue: { type: 'text', text: 'Scissors' }, assets: {} }, mode: 'graded', langs, resolveAssetUrl: (x) => x, onRespond: () => {} };
    const { rerender } = render(<TypedItem {...props} busy={false} />);
    const other = document.createElement('button');
    document.body.appendChild(other);
    // busy flips true without item.id changing — the scenario the timer's
    // own closure cannot see without a live ref.
    rerender(<TypedItem {...props} busy />);
    act(() => { other.focus(); });
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.queryByTestId('jamo-keypad')).toBeNull();
    expect(document.activeElement).toBe(other); // no surprise refocus either
    rerender(<TypedItem {...props} busy={false} />); // busy clears, same item
    expect(screen.queryByTestId('jamo-keypad')).toBeNull(); // still closed
    document.body.removeChild(other);
  });

  it('does not auto-open once the item is already answered, and the state never flips underneath the render gate', () => {
    vi.useFakeTimers();
    const props = { item: { id: 'k9', type: 'typed', task: '3.3', cue: { type: 'text', text: 'Scissors' }, assets: {} }, mode: 'graded', langs, resolveAssetUrl: (x) => x, onRespond: () => {}, onContinue: () => {} };
    const { rerender } = render(<TypedItem {...props} />);
    rerender(<TypedItem {...props} result={{ correct: true, score: 10, answer: 'Scissors' }} />);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.queryByTestId('jamo-keypad')).toBeNull();
    // Not a real transition (a graded item never un-answers) — but it proves
    // the internal boolean genuinely never flipped, not just that the render
    // gate happened to hide it while `result` was present.
    rerender(<TypedItem {...props} result={null} />);
    expect(screen.queryByTestId('jamo-keypad')).toBeNull();
  });
});

describe('TypedItem — busy keeps the keypad, Show me', () => {
  const cueItem = { id: 'b1', type: 'typed', task: '3.3', cue: { type: 'text', text: 'Scissors' }, assets: {} };

  it('an open keypad and its toggle stay mounted while a submit is in flight; only an answer removes them', () => {
    const props = { item: cueItem, mode: 'graded', langs, resolveAssetUrl: (x) => x, onRespond: () => {}, onContinue: () => {} };
    const { rerender } = render(<TypedItem {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /korean keypad/i }));
    rerender(<TypedItem {...props} busy />);
    expect(screen.getByTestId('jamo-keypad')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /korean keypad/i })).toBeInTheDocument();
    rerender(<TypedItem {...props} result={{ correct: true, score: 10, answer: '가위' }} />);
    expect(screen.queryByTestId('jamo-keypad')).toBeNull();
    expect(screen.queryByRole('button', { name: /korean keypad/i })).toBeNull();
  });

  it('practice mode (drill type step) offers Show me → {typed:""}', () => {
    const onRespond = vi.fn();
    render(<TypedItem item={cueItem} mode="practice" langs={langs} resolveAssetUrl={(x) => x} onRespond={onRespond} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show me' }));
    expect(onRespond).toHaveBeenCalledWith({ typed: '' });
  });

  it('Write without help (an unjudged typed item) offers Show me; a judged one and copy do not', () => {
    const { rerender } = render(<TypedItem item={{ ...cueItem, graded: false }} mode="graded" langs={langs} resolveAssetUrl={(x) => x} onRespond={() => {}} />);
    expect(screen.getByRole('button', { name: 'Show me' })).toBeInTheDocument();
    rerender(<TypedItem item={{ ...cueItem, id: 'b2' }} mode="graded" langs={langs} resolveAssetUrl={(x) => x} onRespond={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Show me' })).toBeNull();
    rerender(<TypedItem item={{ id: 'b3', type: 'copy', word, assets: {} }} mode="copy" langs={langs} resolveAssetUrl={(x) => x} onRespond={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Show me' })).toBeNull();
  });
});

describe('SummaryItem', () => {
  it('shows the quizzed count and calls onExit on Space', () => {
    const onExit = vi.fn();
    render(<SummaryItem item={{ quizzed: 5 }} onExit={onExit} />);
    expect(screen.getByText('5 words quizzed')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: ' ' });
    expect(onExit).toHaveBeenCalled();
  });
});
