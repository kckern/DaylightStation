import { describe, it, expect, vi } from 'vitest';
import { IssueDirectLaunch } from './IssueDirectLaunch.mjs';

const ladder = {
  get surface() { return 'portal'; },
  issueLaunchTarget: vi.fn(({ userId, corpusId }) => ({
    kind: 'program', program: 'sentence-ladder', corpusId, studyGrant: `grant:${userId}:${corpusId}`,
  })),
};
const shelf = {
  get surface() { return 'portal'; },
  issueLaunchTarget: vi.fn(({ userId }) => ({
    kind: 'program', program: 'book-log', bookGrant: `book:${userId}`,
  })),
};
// A launcher that only dispatches — it has no on-screen target to hand over.
const dispatchOnly = { launch: vi.fn() };

const make = (over = {}) => new IssueDirectLaunch({
  launchers: new Map([
    ['sentence-ladder', ladder],
    ['book-log', shelf],
    ['broadcast-only', dispatchOnly],
  ]),
  roster: () => [{ id: 'kid1' }, { id: 'kid2' }],
  logger: { warn: vi.fn() },
  ...over,
});

describe('IssueDirectLaunch', () => {
  it('mints the launch target a code would have produced', async () => {
    const { target } = await make().execute({
      learnerId: 'kid1', programId: 'sentence-ladder', instance: 'glossika-korean',
    });
    expect(target).toEqual({
      kind: 'program',
      program: 'sentence-ladder',
      corpusId: 'glossika-korean',
      studyGrant: 'grant:kid1:glossika-korean',
    });
  });

  it('never dispatches — the work opens here, not on the Portal', async () => {
    await make().execute({ learnerId: 'kid1', programId: 'sentence-ladder', instance: 'x' });
    expect(dispatchOnly.launch).not.toHaveBeenCalled();
  });

  it('serves a program that needs no instance', async () => {
    const { target } = await make().execute({ learnerId: 'kid2', programId: 'book-log' });
    expect(target.bookGrant).toBe('book:kid2');
  });

  it('passes the instance under both names the launchers use', async () => {
    ladder.issueLaunchTarget.mockClear();
    await make().execute({ learnerId: 'kid1', programId: 'sentence-ladder', instance: 'corpus-a' });
    expect(ladder.issueLaunchTarget).toHaveBeenCalledWith(
      expect.objectContaining({ corpusId: 'corpus-a', programInstance: 'corpus-a' }),
    );
  });

  it('logs every issue at warn, naming the learner', async () => {
    const logger = { warn: vi.fn() };
    await make({ logger }).execute({ learnerId: 'kid1', programId: 'book-log' });
    expect(logger.warn).toHaveBeenCalledWith('school.direct-launch.issued', expect.objectContaining({
      learnerId: 'kid1', programId: 'book-log',
    }));
  });

  describe('refusals', () => {
    it('refuses an unknown program', async () => {
      await expect(make().execute({ learnerId: 'kid1', programId: 'nope' })).rejects.toThrow(/program/);
    });

    it('refuses a launcher with no on-screen target', async () => {
      await expect(make().execute({ learnerId: 'kid1', programId: 'broadcast-only' }))
        .rejects.toThrow(/cannot be opened directly/);
    });

    it('refuses a learner who is not on the roster', async () => {
      await expect(make().execute({ learnerId: 'stranger', programId: 'book-log' }))
        .rejects.toThrow(/learner/);
    });

    it.each([undefined, '', '../etc', 'a b'])('refuses a malformed learner id: %j', async (learnerId) => {
      await expect(make().execute({ learnerId, programId: 'book-log' })).rejects.toThrow();
    });

    it('refuses a malformed instance rather than passing it down', async () => {
      await expect(make().execute({
        learnerId: 'kid1', programId: 'sentence-ladder', instance: '../../secrets',
      })).rejects.toThrow(/instance/);
    });
  });

  it('still serves when the roster cannot be read, rather than locking the admin out', async () => {
    const logger = { warn: vi.fn() };
    const svc = make({ roster: () => { throw new Error('unreadable'); }, logger });
    const { target } = await svc.execute({ learnerId: 'kid1', programId: 'book-log' });
    expect(target.kind).toBe('program');
    expect(logger.warn).toHaveBeenCalledWith('school.direct-launch.roster-unreadable', expect.anything());
  });

  it('lists what can be opened, and which programs need an instance', () => {
    const listed = make().available();
    expect(listed.map((p) => p.programId)).toEqual(['sentence-ladder', 'book-log']);
    expect(listed.find((p) => p.programId === 'sentence-ladder').instanceRequired).toBe(true);
    expect(listed.find((p) => p.programId === 'book-log').instanceRequired).toBe(false);
  });
});
