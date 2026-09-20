import { describe, it, expect } from 'vitest';
import { NoArcadeGameTimeGrants } from './NoArcadeGameTimeGrants.mjs';
import { EnforceArcadeGameBudget } from '#apps/gaming/usecases/EnforceArcadeGameBudget.mjs';

describe('NoArcadeGameTimeGrants', () => {
  it('answers no grant, which is not an unlimited one', async () => {
    expect(await new NoArcadeGameTimeGrants().forSession({ id: 'ps_1' })).toBeNull();
  });

  it('leaves enforcement inert — nothing warns, nothing is stopped', async () => {
    const killed = [];
    const enforce = new EnforceArcadeGameBudget({
      grants: new NoArcadeGameTimeGrants(),
      terminator: { endPlay: async (d) => { killed.push(d); return { ok: true }; } },
      logger: { info() {}, warn() {}, error() {} },
    });
    await enforce.progress({ id: 'ps_1', deviceId: 'tv', playedMs: 10 * 60 * 60 * 1000, isEnded: () => false });
    expect(killed).toEqual([]);
  });
});
