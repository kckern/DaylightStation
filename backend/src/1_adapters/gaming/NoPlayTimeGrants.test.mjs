import { describe, it, expect } from 'vitest';
import { NoPlayTimeGrants } from './NoPlayTimeGrants.mjs';
import { EnforcePlayBudget } from '#apps/gaming/usecases/EnforcePlayBudget.mjs';

describe('NoPlayTimeGrants', () => {
  it('answers no grant, which is not an unlimited one', async () => {
    expect(await new NoPlayTimeGrants().forSession({ id: 'ps_1' })).toBeNull();
  });

  it('leaves enforcement inert — nothing warns, nothing is stopped', async () => {
    const killed = [];
    const enforce = new EnforcePlayBudget({
      grants: new NoPlayTimeGrants(),
      terminator: { endPlay: async (d) => { killed.push(d); return { ok: true }; } },
      logger: { info() {}, warn() {}, error() {} },
    });
    await enforce.progress({ id: 'ps_1', deviceId: 'tv', playedMs: 10 * 60 * 60 * 1000, isEnded: () => false });
    expect(killed).toEqual([]);
  });
});
