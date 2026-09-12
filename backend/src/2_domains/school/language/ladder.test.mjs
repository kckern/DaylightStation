/**
 * Ladder tests. The load-bearing behaviour here is capability filtering: it is
 * what stops an unattended kiosk offering a rung the device cannot perform.
 */
import { describe, it, expect } from 'vitest';
import {
  RUNGS, RUNG_IDS, ROLES, rungById, resolveRole,
  requirementFor, satisfiesRequirement, chainFor, nextRung, graduationEdges, creditChain,
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
      .toEqual({ anyOf: [{ kind: 'textInput', language: 'KR' }] });
    expect(requirementFor(rungById('interpretation'), KOREAN))
      .toEqual({ anyOf: [{ kind: 'textInput', language: 'EN' }] });
  });

  it('maps an audio response to the microphone', () => {
    expect(requirementFor(rungById('recording'), KOREAN))
      .toEqual({ anyOf: [{ kind: 'microphone' }] });
  });

  it('offers the microphone as an ALTERNATIVE to typing the interpretation', () => {
    // The payoff of the spoken answer: the child says the English, it is
    // transcribed into the field, and the requirement is met without a key.
    expect(requirementFor(rungById('interpretation'), KOREAN, { voiceAnswer: true }))
      .toEqual({ anyOf: [{ kind: 'textInput', language: 'EN' }, { kind: 'microphone' }] });
  });

  it('does NOT open dictation to a spoken answer', () => {
    // Speaking the Korean that was just played back is repetition — a rung
    // that already exists. Accepting it as dictation would credit listening
    // as writing and quietly delete the only rung that practises the script.
    expect(requirementFor(rungById('dictation'), KOREAN, { voiceAnswer: true }))
      .toEqual({ anyOf: [{ kind: 'textInput', language: 'KR' }] });
  });

  it('ignores the spoken alternative where the server cannot transcribe', () => {
    expect(requirementFor(rungById('interpretation'), KOREAN, { voiceAnswer: false }))
      .toEqual({ anyOf: [{ kind: 'textInput', language: 'EN' }] });
  });
});

describe('satisfiesRequirement', () => {
  it('is met by ANY ONE alternative, not all of them', () => {
    const need = requirementFor(rungById('interpretation'), KOREAN, { voiceAnswer: true });
    expect(satisfiesRequirement({ microphone: true, textInput: [] }, need)).toBe(true);
    expect(satisfiesRequirement({ microphone: false, textInput: ['EN'] }, need)).toBe(true);
    expect(satisfiesRequirement({ microphone: false, textInput: ['KR'] }, need)).toBe(false);
  });

  it('treats a requirement of nothing as met', () => {
    expect(satisfiesRequirement({}, null)).toBe(true);
    expect(satisfiesRequirement({}, undefined)).toBe(true);
  });

  it('refuses a textInput alternative that names no language', () => {
    // A corpus with an unbound role must not resolve to "any keyboard will do".
    expect(satisfiesRequirement({ textInput: ['EN', 'KR'] }, { anyOf: [{ kind: 'textInput', language: null }] }))
      .toBe(false);
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

  it('offers interpretation to a mic-only panel where the server can transcribe', () => {
    // The Portal with no keyboard evidence. Before the spoken answer this
    // device was told to go elsewhere for every rung but repetition.
    const micOnly = { microphone: true, textInput: [] };
    expect(chainFor(micOnly, KOREAN, { voiceAnswer: true }))
      .toEqual(['repetition', 'recording', 'interpretation']);
  });

  it('does NOT offer it on a server that cannot transcribe', () => {
    // The dead end this filter exists to prevent: a rung with no way in and
    // no way past. Without an AI gateway the microphone answers nothing.
    const micOnly = { microphone: true, textInput: [] };
    expect(chainFor(micOnly, KOREAN, { voiceAnswer: false }))
      .toEqual(['repetition', 'recording']);
    expect(chainFor(micOnly, KOREAN)).toEqual(['repetition', 'recording']);
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

describe('creditChain', () => {
  it('defaults malformed or empty configuration to the full ladder', () => {
    expect(creditChain(null, KOREAN)).toEqual(RUNG_IDS);
    expect(creditChain([], KOREAN)).toEqual(RUNG_IDS);
    expect(creditChain(['unknown'], KOREAN)).toEqual(RUNG_IDS);
    expect(creditChain('repetition', KOREAN)).toEqual(RUNG_IDS);
  });

  it('filters an enrollment subset into pedagogical ladder order', () => {
    expect(creditChain(['interpretation', 'repetition', 'repetition'], KOREAN))
      .toEqual(['repetition', 'interpretation']);
  });

  it('returns a fresh array', () => {
    const chain = creditChain(null, KOREAN);
    expect(chain).not.toBe(RUNG_IDS);
    chain.pop();
    expect(RUNG_IDS).toHaveLength(RUNGS.length);
  });
});
