import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FlashcardItem from './FlashcardItem.jsx';
import ChoiceItem from './ChoiceItem.jsx';
import TypedItem from './TypedItem.jsx';
import SummaryItem from './SummaryItem.jsx';
import { playClip } from '../wordLadderAudio.js';

vi.mock('../wordLadderAudio.js', () => ({ playClip: vi.fn(async () => true) }));
const word = { wordId: 'gawi', term: '가위', gloss: 'Scissors', pronunciation: null, kind: 'word', media: { image: 'img', audio: 'aud', glossAudio: null } };
const langs = { term: 'ko', gloss: 'en' };

describe('FlashcardItem', () => {
  it('front shows only the Korean; Space flips to picture + gloss; 3 sorts Got it', () => {
    const onRespond = vi.fn();
    render(<FlashcardItem item={{ id: 'r1:s:0', type: 'flashcard', mode: 'stream', word }} langs={langs} resolveAssetUrl={(x) => x} onRespond={onRespond} />);
    expect(screen.getByText('가위')).toBeInTheDocument();
    expect(screen.queryByText('Scissors')).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
    fireEvent.keyDown(window, { key: ' ' });
    expect(screen.getByText('Scissors')).toBeInTheDocument();
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
    expect(playClip).toHaveBeenCalledWith('aud-gawi');
    playClip.mockClear();
    fireEvent.keyDown(window, { key: 'h' });
    expect(playClip).toHaveBeenCalledWith('aud-gawi');
  });
});

describe('TypedItem', () => {
  it('Enter submits the typed answer and number keys do not leak from the field', () => {
    const onRespond = vi.fn();
    render(<TypedItem item={{ id: 't', type: 'typed', task: '3.3', cue: { type: 'text', text: 'Scissors' }, assets: {} }} mode="graded" langs={langs} resolveAssetUrl={(x) => x} onRespond={onRespond} />);
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

describe('SummaryItem', () => {
  it('shows the quizzed count and calls onExit on Space', () => {
    const onExit = vi.fn();
    render(<SummaryItem item={{ quizzed: 5 }} onExit={onExit} />);
    expect(screen.getByText('5 words quizzed')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: ' ' });
    expect(onExit).toHaveBeenCalled();
  });
});
