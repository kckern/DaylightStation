import { describe, expect, it } from 'vitest';
import { CardLadderDoorLauncher } from './CardLadderDoorLauncher.mjs';

const enroll = (deckId) => ({ programId: 'flashcards', deckId, policy: { mode: 'card-ladder' } });
const make = (programs) => new CardLadderDoorLauncher({
  assignments: { get: async () => ({ programs }) },
  packageOf: async (deckId) => (deckId.includes('korean') ? 'korean-vocab' : 'spanish-vocab'),
});

describe('CardLadderDoorLauncher', () => {
  it('resolves the single enrollment with no instance', async () => {
    expect(await make([enroll('language/korean/week-02')]).issueLaunchTarget({ userId: 'u', programInstance: null }))
      .toEqual({ kind: 'program', program: 'flashcards', deckId: 'language/korean/week-02', policy: { mode: 'card-ladder' } });
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

describe('CardLadderDoorLauncher — pre-rename enrollments', () => {
  it('resolves an enrollment still written as policy.mode word-ladder', async () => {
    const launcher = make([{ programId: 'flashcards', deckId: 'language/korean/week-02', policy: { mode: 'word-ladder' } }]);
    expect((await launcher.issueLaunchTarget({ userId: 'u', programInstance: null })).deckId).toBe('language/korean/week-02');
  });
});
