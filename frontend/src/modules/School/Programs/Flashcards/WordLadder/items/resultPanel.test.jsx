import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TypedItem from './TypedItem.jsx';
import ChoiceItem from './ChoiceItem.jsx';
import { playClip } from '../wordLadderAudio.js';

// Owner, 2026-09-23: "You said this, but actually it's this" — a result is a
// prominent card under the prompt that stays until Next, never shaming; a
// right answer gets a proper toast too.
vi.mock('../wordLadderAudio.js', () => ({ playClip: vi.fn(async () => true) }));
vi.mock('../../../../../../hooks/useHardwareKeyboard.js', () => ({ useHardwareKeyboard: () => false, default: () => false }));

const langs = { term: 'ko', gloss: 'en' };
const id = (x) => x;
const typedItem = { id: 't1', type: 'typed', task: '3.3', cue: { type: 'english', text: 'Scissors', image: false, audio: false }, assets: {} };
const panel = () => screen.getByTestId('wl-result');

function typedWith(result, typed = '가비') {
  const view = render(<TypedItem item={typedItem} mode="graded" langs={langs} resolveAssetUrl={id} onRespond={vi.fn()} onContinue={vi.fn()} />);
  fireEvent.change(screen.getByRole('textbox', { name: /your answer/i }), { target: { value: typed } });
  view.rerender(<TypedItem item={typedItem} mode="graded" langs={langs} resolveAssetUrl={id} onRespond={vi.fn()} onContinue={vi.fn()} result={result} />);
  return view;
}

afterEach(() => playClip.mockClear());

describe('TypedItem result panel', () => {
  it('wrong: "Not quite", You typed (muted) and The answer (large, Korean lang), announced', () => {
    typedWith({ correct: false, answer: '가위', score: 2, audio: 'aud-gawi' });
    expect(panel()).toHaveAttribute('role', 'status');
    expect(panel()).toHaveAttribute('aria-live', 'polite');
    expect(within(panel()).getByText('Not quite')).toBeInTheDocument();
    expect(within(panel()).getByText('You typed')).toBeInTheDocument();
    expect(within(panel()).getByText('가비')).toHaveClass('wl-result__typed');
    expect(within(panel()).getByText('The answer')).toBeInTheDocument();
    const answer = within(panel()).getByText('가위');
    expect(answer.closest('[lang="ko"]')).not.toBeNull();
    const listen = within(panel()).getByRole('button', { name: /listen/i });
    expect(listen.querySelector('.ds-touch__key')).toHaveTextContent('Tab');
    fireEvent.keyDown(window, { key: 'Tab', code: 'Tab' });
    expect(playClip).toHaveBeenCalledWith('aud-gawi', 'term');
  });

  it('a near miss (score < 10) says Close! and shows the spelling', () => {
    typedWith({ correct: true, answer: '가위', score: 8 }, '가외');
    expect(within(panel()).getByText(/Close! It's spelled:/)).toBeInTheDocument();
    expect(within(panel()).getByText('가위')).toBeInTheDocument();
  });

  it('right: a positive toast with the term', () => {
    typedWith({ correct: true, answer: '가위', score: 10 }, '가위');
    expect(panel()).toHaveClass('wl-result--right');
    expect(within(panel()).getByRole('heading')).toHaveTextContent(/^(Got it!|Nice!|Yes!)$/);
    expect(within(panel()).getByText('가위')).toBeInTheDocument();
    expect(within(panel()).queryByText(/Close!/)).toBeNull();
  });

  it('the button row keeps Next, and the panel is not in it', () => {
    const { container } = typedWith({ correct: false, answer: '가위', score: 2 });
    const controls = container.querySelector('.wl-controls');
    expect(within(controls).getByRole('button', { name: /next/i })).toBeInTheDocument();
    expect(controls.contains(panel())).toBe(false);
    expect(controls.querySelector('.wl-verdict')).toBeNull();
  });
});

describe('ChoiceItem result panel', () => {
  const item = { id: 'c1', type: 'choice', task: '3.1', cue: { type: 'english', text: 'Scissors', image: false, audio: false }, choices: ['가위', '풀', '책', '펜'], assets: {} };

  it('wrong: highlights the chosen and the correct option, and says The answer', () => {
    const onRespond = vi.fn();
    const { rerender } = render(<ChoiceItem item={item} langs={langs} resolveAssetUrl={id} onRespond={onRespond} onContinue={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /풀/ }));
    rerender(<ChoiceItem item={item} langs={langs} resolveAssetUrl={id} onRespond={onRespond} onContinue={vi.fn()} result={{ correct: false, answer: '가위', audio: 'aud-gawi' }} />);
    expect(screen.getByRole('button', { name: /풀/ })).toHaveClass('is-chosen');
    expect(screen.getByRole('button', { name: /가위/ })).toHaveClass('is-answer');
    expect(within(panel()).getByText('Not quite')).toBeInTheDocument();
    expect(within(panel()).getByText('The answer')).toBeInTheDocument();
    expect(within(panel()).getByText('가위')).toBeInTheDocument();
  });

  it('right: the same positive toast', () => {
    render(<ChoiceItem item={item} langs={langs} resolveAssetUrl={id} onRespond={vi.fn()} onContinue={vi.fn()} result={{ correct: true, answer: '가위' }} />);
    expect(panel()).toHaveClass('wl-result--right');
    expect(within(panel()).getByRole('heading')).toHaveTextContent(/^(Got it!|Nice!|Yes!)$/);
  });
});
