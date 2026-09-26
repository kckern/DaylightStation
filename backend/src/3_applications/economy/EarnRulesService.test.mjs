// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { EarnRulesService } from './EarnRulesService.mjs';
import { DEFAULT_RULESET } from '#domains/economy/earnings/index.mjs';

class MemoryStore {
  doc = null; archived = [];
  async read() { return this.doc ? structuredClone(this.doc) : null; }
  async write(doc, { previous = null } = {}) {
    if (previous && previous.revision > 0) this.archived.unshift(structuredClone(previous));
    this.doc = structuredClone(doc);
  }
  async history() { return structuredClone(this.archived); }
}

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const build = (store = new MemoryStore()) => ({
  store,
  service: new EarnRulesService({ store, clock: () => new Date('2026-09-26T16:00:00.000Z'), logger: silent }),
});

describe('EarnRulesService', () => {
  it('reads the default rules (revision 0) when none were ever written', async () => {
    const { service } = build();
    const rs = await service.get();
    expect(rs.revision).toBe(0);
    expect(rs.rules.map((r) => r.id)).toEqual(DEFAULT_RULESET.rules.map((r) => r.id));
  });

  it('a per-learner override is stored as the next revision, stamped with who and when', async () => {
    const { service, store } = build();
    const next = await service.setUserOverride({ learnerId: 'little', patch: { multiplier: 2, rules: { 'korean-daily': { reward: 3 } } }, actorId: 'parent' });
    expect(next).toMatchObject({ revision: 1, revisedBy: 'parent', revisedAt: '2026-09-26T16:00:00.000Z' });
    expect(next.users.little).toEqual({ multiplier: 2, rules: { 'korean-daily': { reward: { silver: 3, gems: 0 } } } });
    expect(store.doc.revision).toBe(1);
    // Revision 0 was the built-in default — never written, so nothing to archive.
    expect(store.archived).toEqual([]);
  });

  it('every later write archives the revision it replaces', async () => {
    const { service, store } = build();
    await service.setUserOverride({ learnerId: 'little', patch: { multiplier: 2 }, actorId: 'parent' });
    await service.setUserOverride({ learnerId: 'little', patch: { multiplier: 3 }, actorId: 'parent' });
    expect(store.doc.revision).toBe(2);
    expect((await service.history()).map((d) => d.revision)).toEqual([1]);
  });

  it('replacing the household rules keeps the learners\' overrides unless new ones are given', async () => {
    const { service } = build();
    await service.setUserOverride({ learnerId: 'little', patch: { multiplier: 2 }, actorId: 'parent' });
    const next = await service.replace({ doc: { rules: [{ id: 'green-day', kind: 'day-met', reward: 3 }] }, actorId: 'parent' });
    expect(next.revision).toBe(2);
    expect(next.rules.map((r) => r.id)).toEqual(['green-day']);
    expect(next.users.little).toEqual({ multiplier: 2 });
  });

  it('refuses a write with no actor, and an invalid patch, without writing', async () => {
    const { service, store } = build();
    await expect(service.setUserOverride({ learnerId: 'little', patch: { multiplier: 2 }, actorId: null })).rejects.toThrow(/actor/);
    await expect(service.setUserOverride({ learnerId: 'little', patch: { rules: { nope: { reward: 1 } } }, actorId: 'parent' })).rejects.toThrow(/nope/);
    expect(store.doc).toBeNull();
  });

  it('a stored document that no longer validates is refused loudly, not silently replaced', async () => {
    const store = new MemoryStore();
    store.doc = { revision: 3, rules: [{ id: 'x', kind: 'bonus', reward: 1 }] };
    const { service } = build(store);
    await expect(service.get()).rejects.toThrow(/kind/);
  });
});
