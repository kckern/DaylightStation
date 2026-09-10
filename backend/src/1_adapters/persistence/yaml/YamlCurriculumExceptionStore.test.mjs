// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { YamlCurriculumExceptionStore } from './YamlCurriculumExceptionStore.mjs';

const applied = (exceptionId, decidedAt) => ({
  schema: 'school.curriculum-exception/v1', operation: 'applied', exceptionId, decidedAt,
});
const retracted = (exceptionId, retractedAt) => ({
  schema: 'school.curriculum-exception/v1', operation: 'retracted', exceptionId, retractedAt,
});

/** A store whose ledger is in memory: `list()` is the only read the class does. */
function storeWith(records) {
  const store = new YamlCurriculumExceptionStore({ configService: { getHouseholdPath: () => '/nowhere' } });
  store.list = async () => structuredClone(records);
  return store;
}

describe('YamlCurriculumExceptionStore.activeAsOf', () => {
  const D2 = '2026-09-02T12:00:00.000Z';
  const D4 = '2026-09-04T12:00:00.000Z';
  const D6 = '2026-09-06T12:00:00.000Z';

  it('active() is activeAsOf(now): every applied record minus every retraction', async () => {
    const store = storeWith([applied('a', D2), applied('b', D4), retracted('a', D6)]);
    expect((await store.active()).map((r) => r.exceptionId)).toEqual(['b']);
  });

  it('an exception applied AFTER the instant is absent from a replay of that instant', async () => {
    const store = storeWith([applied('a', D2), applied('b', D4)]);
    const asOf = await store.activeAsOf('2026-09-03T11:00:00.000Z');
    expect(asOf.map((r) => r.exceptionId)).toEqual(['a']);
  });

  it('a retraction AFTER the instant does not un-apply what was in force then', async () => {
    const store = storeWith([applied('a', D2), retracted('a', D6)]);
    expect((await store.activeAsOf(D4)).map((r) => r.exceptionId)).toEqual(['a']);
    expect((await store.activeAsOf('2026-09-07T00:00:00.000Z')).map((r) => r.exceptionId)).toEqual([]);
  });

  it('a record with no stamp is always in force — the ledger predates the stamp', async () => {
    const store = storeWith([{ operation: 'applied', exceptionId: 'old' }]);
    expect((await store.activeAsOf('2000-01-01T00:00:00.000Z')).map((r) => r.exceptionId)).toEqual(['old']);
  });
});
