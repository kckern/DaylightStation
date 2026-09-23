import { describe, expect, it } from 'vitest';
import { WordLadderDoorLauncher } from './WordLadderDoorLauncher.mjs';

const enroll = (deckId) => ({ programId: 'flashcards', deckId, policy: { mode: 'word-ladder' } });
const make = (programs) => new WordLadderDoorLauncher({
  assignments: { get: async () => ({ programs }) },
  packageOf: async (deckId) => (deckId.includes('korean') ? 'korean-vocab' : 'spanish-vocab'),
});

describe('WordLadderDoorLauncher', () => {
  it('resolves the single enrollment with no instance', async () => {
    expect(await make([enroll('language/korean/week-02')]).issueLaunchTarget({ userId: 'u', programInstance: null }))
      .toEqual({ kind: 'program', program: 'flashcards', deckId: 'language/korean/week-02', policy: { mode: 'word-ladder' } });
  });
  it('several packages need an instance', async () => {
    const launcher = make([enroll('language/korean/week-02'), enroll('language/spanish/week-01')]);
    await expect(launcher.issueLaunchTarget({ userId: 'u', programInstance: null })).rejects.toThrow(/korean-vocab.*spanish-vocab/);
    expect((await launcher.issueLaunchTarget({ userId: 'u', programInstance: 'spanish-vocab' })).deckId).toBe('language/spanish/week-01');
  });
  it('no enrollment → null', async () => {
    expect(await make([]).issueLaunchTarget({ userId: 'u', programInstance: null })).toBeNull();
  });
});
