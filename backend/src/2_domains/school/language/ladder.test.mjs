/**
 * Ladder tests. The load-bearing behaviour here is capability filtering: it is
 * what stops an unattended kiosk offering a rung the device cannot perform.
 */
import { describe, it, expect } from 'vitest';
import {
  RUNGS, RUNG_IDS, ROLES, rungById, resolveRole,
  requirementFor, chainFor, nextRung, graduationEdges,
} from './ladder.mjs';

const KOREAN = { source: 'EN', target: 'KR' };
const FULLY_EQUIPPED = { microphone: true, textInput: ['EN', 'KR'] };

describe('rung definitions', () => {
  it('names no language anywhere — only roles', () => {
    const serialized = JSON.stringify(RUNGS);
    expect(serialized).not.toMatch(/EN|KR|english|korean|hangul/i);
  });

  it('opens with a rung that requires nothing, so any device can start', () => {
    expect(requirementFor(RUNGS[0], KOREAN)).toBeNull();
  });

  it('plays the target twice on repetition — attempt, then correction', () => {
    const prompt = rungById('repetition').prompt;
    expect(prompt).toEqual([ROLES.SOURCE, ROLES.TARGET, ROLES.TARGET]);
  });
});

describe('resolveRole', () => {
  it('binds roles through the corpus, not through code', () => {
    expect(resolveRole(ROLES.TARGET, KOREAN)).toBe('KR');
    expect(resolveRole(ROLES.SOURCE, KOREAN)).toBe('EN');
  });

  it('supports a reversed course with no domain change', () => {
    const reversed = { source: 'KR', target: 'EN' };
    expect(resolveRole(ROLES.TARGET, reversed)).toBe('EN');
  });

  it('returns null rather than guessing when the binding is absent', () => {
    expect(resolveRole(ROLES.TARGET, null)).toBeNull();
  });
});

describe('requirementFor', () => {
  it('distinguishes the two typing rungs by script', () => {
    // The whole reason textInput is per-language and not a boolean.
    expect(requirementFor(rungById('dictation'), KOREAN))
      .toEqual({ kind: 'textInput', language: 'KR' });
    expect(requirementFor(rungById('interpretation'), KOREAN))
      .toEqual({ kind: 'textInput', language: 'EN' });
  });

  it('maps an audio response to the microphone', () => {
    expect(requirementFor(rungById('recording'), KOREAN)).toEqual({ kind: 'microphone' });
  });
});

describe('chainFor', () => {
  it('is the full ladder when everything is available', () => {
    expect(chainFor(FULLY_EQUIPPED, KOREAN)).toEqual(RUNG_IDS);
  });

  it('offers interpretation but NOT dictation on a Latin-only keyboard', () => {
    // A US keyboard can type the English meaning; it cannot type Hangul.
    // Collapsing both to `keyboard` would strand the learner on dictation.
    const chain = chainFor({ microphone: false, textInput: ['EN'] }, KOREAN);
    expect(chain).toEqual(['repetition', 'interpretation']);
  });

  it('drops the recording rung when there is no microphone', () => {
    const chain = chainFor({ microphone: false, textInput: ['EN', 'KR'] }, KOREAN);
    expect(chain).toEqual(['repetition', 'dictation', 'interpretation']);
  });

  it('leaves only repetition on a bare touch panel', () => {
    expect(chainFor({}, KOREAN)).toEqual(['repetition']);
  });

  it('is never empty — the program must always have something to do', () => {
    expect(chainFor({ microphone: false, textInput: [] }, KOREAN).length).toBeGreaterThan(0);
    expect(chainFor(undefined, KOREAN).length).toBeGreaterThan(0);
  });
});

describe('nextRung', () => {
  it('walks the full ladder and then retires', () => {
    expect(nextRung('repetition', FULLY_EQUIPPED, KOREAN)).toBe('dictation');
    expect(nextRung('dictation', FULLY_EQUIPPED, KOREAN)).toBe('recording');
    expect(nextRung('recording', FULLY_EQUIPPED, KOREAN)).toBe('interpretation');
    expect(nextRung('interpretation', FULLY_EQUIPPED, KOREAN)).toBeNull();
  });

  it('graduates ACROSS a missing rung rather than stalling on it', () => {
    const noMic = { microphone: false, textInput: ['EN', 'KR'] };
    expect(nextRung('dictation', noMic, KOREAN)).toBe('interpretation');
  });

  it('retires a sentence whose last rung does not exist on this device', () => {
    // Evidence recorded on a better-equipped device must not create phantom
    // work here — a `recording` event on a mic-less panel means "done", not
    // "resume at a guessed position".
    expect(nextRung('recording', { textInput: ['EN'] }, KOREAN)).toBeNull();
  });

  it('returns null for an unknown rung', () => {
    expect(nextRung('nonsense', FULLY_EQUIPPED, KOREAN)).toBeNull();
  });
});

describe('graduationEdges', () => {
  it('agrees with nextRung about what follows what', () => {
    const edges = graduationEdges(FULLY_EQUIPPED, KOREAN);
    for (const { from, to } of edges) {
      expect(nextRung(from, FULLY_EQUIPPED, KOREAN)).toBe(to);
    }
  });

  it('has no edges when only one rung is available', () => {
    expect(graduationEdges({}, KOREAN)).toEqual([]);
  });
});
