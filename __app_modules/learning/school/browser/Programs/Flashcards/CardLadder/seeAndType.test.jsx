// See-and-type packages (`cards: see-and-type`): Learn › Quiz trail, and a
// copy card graded on the first try (task K.1) that holds its verdict.
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { STEP_HINTS, stepHint, stepTrail } from "./stepTrail.js";
import TypedItem from "./items/TypedItem.jsx";
import { playClip } from "./cardLadderAudio.js";

vi.mock("./cardLadderAudio.js", () => ({ playClip: vi.fn(async () => true) }));
vi.mock("../../../../../../../frontend/src/hooks/useHardwareKeyboard.js", () => ({ useHardwareKeyboard: () => false, default: () => false }));

const base = { cards: 'see-and-type', rechecksLeft: 0, rechecksTotal: 0, roundsDone: 0, learnToday: true, doneToday: false, round: null, drill: null, practice: null, activeMs: 0, capMs: 900000 };
const round = (phase) => ({ ...base, phase: 'round', round: { index: 1, kind: 'new', size: 3, phase, remainingInStream: 0, quizLeft: 3, hasMatch: false } });
const ids = (trail) => trail.steps.map((s) => s.id);
const langs = { target: 'ko', anchor: 'ko', targetScript: 'hangul' };
const word = (audio) => ({ wordId: 'a', term: 'ㅏ', gloss: '', pronunciation: null, kind: 'word', media: { image: null, audio, glossAudio: null } });

describe('see-and-type trail', () => {
  it('rounds are Learn › Quiz — no Sort, no Match', () => {
    expect(ids(stepTrail(round('intro')))).toEqual(['learn', 'quiz', 'practice']);
    const quiz = stepTrail(round('quiz'));
    expect(quiz.steps.find((s) => s.id === 'learn').state).toBe('done');
    expect(quiz.current).toBe('quiz');
    expect(ids(stepTrail({ ...base, phase: 'rechecks', rechecksLeft: 2, rechecksTotal: 2 }))).toEqual(['review', 'learn', 'quiz', 'practice']);
  });
  it('has its own hints; a standard package keeps the old ones', () => {
    expect(stepHint('learn', base)).toMatch(/keyboard/);
    expect(stepHint('learn', { cards: 'standard' })).toBe(STEP_HINTS.learn);
  });
});

describe('see-and-type card', () => {
  it('learn copy: plays the sound on show, offers Skip', () => {
    playClip.mockClear();
    render(<TypedItem item={{ id: 'r1:i:a:copy', type: 'copy', wordId: 'a', word: word('aud') }} mode="copy" langs={langs} resolveAssetUrl={(x) => x} onRespond={() => {}} />);
    expect(screen.getByText('ㅏ')).toBeInTheDocument();
    expect(playClip).toHaveBeenCalledWith('aud', 'term', { trigger: 'auto' });
    expect(screen.getByRole('button', { name: /Skip/ })).toBeInTheDocument();
  });
  it('a consonant card has no audio: nothing plays, no Hear it button', () => {
    playClip.mockClear();
    render(<TypedItem item={{ id: 'r1:i:g:copy', type: 'copy', wordId: 'g', word: { ...word(null), term: 'ㄱ' } }} mode="copy" langs={langs} resolveAssetUrl={(x) => x} onRespond={() => {}} />);
    expect(playClip).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Hear it/ })).toBeNull();
  });
  it("graded (K.1): shows the card, Don't know instead of Skip, no anchor cue; a result is held with Next", () => {
    const item = { id: 'r1:q:0', type: 'copy', task: 'K.1', source: 'verify', graded: true, wordId: 'a', word: word('aud') };
    const onRespond = vi.fn();
    const { rerender } = render(<TypedItem item={item} mode="copy" langs={langs} resolveAssetUrl={(x) => x} onRespond={onRespond} />);
    expect(screen.getByText('ㅏ')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Don't know/ })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'ㅓ' } });
    fireEvent.keyDown(screen.getByLabelText('Your answer'), { key: 'Enter' });
    expect(onRespond).toHaveBeenCalledWith({ typed: 'ㅓ' });
    const onContinue = vi.fn();
    rerender(<TypedItem item={item} mode="copy" langs={langs} resolveAssetUrl={(x) => x} onRespond={onRespond} result={{ correct: false, answer: 'ㅏ' }} onContinue={onContinue} />);
    expect(screen.queryByLabelText('Your answer')).toBeNull();
    expect(screen.queryByText(/Try again/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(onContinue).toHaveBeenCalled();
  });
});
