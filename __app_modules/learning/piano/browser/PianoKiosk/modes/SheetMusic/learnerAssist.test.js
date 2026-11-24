import { describe, it, expect } from 'vitest';
import { resolveLearnerAssist, keyboardHintPolicyFor } from './learnerAssist.js';

const learners = { ' Kid ': { collection: 'files:docs/sheet-music/first-notes', keyboardHints: 'always', wrongNoteGhosts: true } };

describe('resolveLearnerAssist', () => {
  it('finds the learner by trimmed, case-folded id', () => {
    expect(resolveLearnerAssist(learners, 'KID')).toEqual({
      collection: 'files:docs/sheet-music/first-notes', keyboardHints: 'always', wrongNoteGhosts: true,
    });
  });

  it('answers today\'s behaviour for anyone without an entry, and for junk', () => {
    const none = { collection: null, keyboardHints: null, wrongNoteGhosts: false };
    expect(resolveLearnerAssist(learners, 'sib')).toEqual(none);
    expect(resolveLearnerAssist(null, 'kid')).toEqual(none);
    expect(resolveLearnerAssist(learners, null)).toEqual(none);
    expect(resolveLearnerAssist({ kid: { keyboardHints: 'loud', wrongNoteGhosts: 'yes' } }, 'kid')).toEqual(none);
  });
});

describe('keyboardHintPolicyFor', () => {
  const always = { keyboardHints: 'always' };
  it('keeps the reading defaults without an assist: help after a wrong note, nothing on the check', () => {
    expect(keyboardHintPolicyFor(null)).toBe('after-wrong');
    expect(keyboardHintPolicyFor(null, { check: true })).toBe('never');
  });
  it('lights every take, the check included, for a learner set to always', () => {
    expect(keyboardHintPolicyFor(always)).toBe('always');
    expect(keyboardHintPolicyFor(always, { check: true })).toBe('always');
  });
  it('never lights the pitch-free rhythm step', () => {
    expect(keyboardHintPolicyFor(always, { rhythm: true })).toBe('never');
  });
});
