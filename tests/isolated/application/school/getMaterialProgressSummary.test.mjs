import { describe, it, expect, vi } from 'vitest';
import { GetMaterialProgressSummary } from '#apps/school/GetMaterialProgressSummary.mjs';

const materials = [
  { id: 'plex:v1', title: 'Bill Nye', subject: 'science', category: 'course' },
  { id: 'plex:v2', title: 'Cash Course', subject: 'math', category: 'course' },
  { id: 'plex:v3', title: 'Atlas', subject: 'history', category: 'reference' },
];
const UNITS = {
  'plex:v1': [
    { id: 'plex:u1', title: 'Air', percent: 100, completed: true, current: false },
    { id: 'plex:u2', title: 'Water', percent: 20, completed: false, current: true },
  ],
  'plex:v2': [
    { id: 'plex:u3', title: 'Budgets', percent: 100, completed: true, current: false },
    { id: 'plex:u4', title: 'Saving', percent: 0, completed: false, current: true },
  ],
  'plex:v3': [{ id: 'plex:u5', title: 'Maps', percent: 0, completed: false, current: true }],
};
const LAST = { 'plex:u1': '2026-07-20T10:00:00Z', 'plex:u3': '2026-07-21T09:00:00Z' };

function makeDeps() {
  return {
    catalog: { execute: async () => ({ sections: [], materials }) },
    getMaterialUnits: { execute: async ({ materialId }) => ({ material: {}, units: UNITS[materialId] }) },
    progressStore: {
      summarize: (units) => ({ completed: 0, total: units.length, lastPlayedAt: LAST[units[0]?.id] ?? null }),
    },
    logger: { warn: () => {} },
  };
}

describe('GetMaterialProgressSummary.execute', () => {
  it('returns only progressed materials, newest activity first', async () => {
    const useCase = new GetMaterialProgressSummary(makeDeps());

    const result = await useCase.execute({ userId: 'kid1' });

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.materialId)).toEqual(['plex:v2', 'plex:v1']);
  });

  it('computes summary fields verbatim from GetMaterialUnits flags', async () => {
    const useCase = new GetMaterialProgressSummary(makeDeps());

    const result = await useCase.execute({ userId: 'kid1' });

    const v1 = result.find((r) => r.materialId === 'plex:v1');
    expect(v1).toEqual({
      materialId: 'plex:v1',
      unitsDone: 1,
      unitTotal: 2,
      nextUnitId: 'plex:u2',
      nextUnitTitle: 'Water',
      percent: 50,
      lastActivity: '2026-07-20T10:00:00Z',
    });
  });

  it('filters by subject when given', async () => {
    const useCase = new GetMaterialProgressSummary(makeDeps());

    const science = await useCase.execute({ userId: 'kid1', subject: 'science' });
    expect(science).toHaveLength(1);
    expect(science[0].materialId).toBe('plex:v1');

    const math = await useCase.execute({ userId: 'kid1', subject: 'math' });
    expect(math).toHaveLength(1);
    expect(math[0].materialId).toBe('plex:v2');
  });

  it('short-circuits guests without touching the catalog', async () => {
    const deps = makeDeps();
    deps.catalog.execute = vi.fn(deps.catalog.execute);
    const useCase = new GetMaterialProgressSummary(deps);

    const result = await useCase.execute({ userId: undefined });

    expect(result).toEqual([]);
    expect(deps.catalog.execute).not.toHaveBeenCalled();
  });

  it('fans out per-material units fetches with bounded concurrency, preserving order and skipping a rejecting material', async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const manyMaterials = Array.from({ length: 20 }, (_, i) => ({
      id: `plex:m${i}`,
      title: `Material ${i}`,
      subject: 'science',
      category: 'course',
    }));
    // Every material carries an obviously-progressed unit so it survives the
    // hasProgress filter and shows up in results (order-check needs all 20,
    // minus the one rejecting entry).
    const FAIL_INDEX = 7;

    let inFlight = 0;
    let maxInFlight = 0;
    const warnCalls = [];

    const deps = {
      catalog: { execute: async () => ({ sections: [], materials: manyMaterials }) },
      getMaterialUnits: {
        execute: async ({ materialId }) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          try {
            await sleep(5);
            if (materialId === `plex:m${FAIL_INDEX}`) {
              throw new Error('boom');
            }
            return {
              material: {},
              units: [{ id: `${materialId}:u1`, title: 'Unit 1', percent: 50, completed: false, current: true }],
            };
          } finally {
            inFlight -= 1;
          }
        },
      },
      progressStore: {
        summarize: (units) => ({ completed: 0, total: units.length, lastPlayedAt: `2026-01-01T00:00:${String(units.length).padStart(2, '0')}Z` }),
      },
      logger: { warn: (...args) => warnCalls.push(args) },
    };

    const useCase = new GetMaterialProgressSummary(deps);
    const result = await useCase.execute({ userId: 'kid1' });

    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(6);

    // The failing material is skipped (with a warn log); every other material
    // survives, and result order matches input (catalog) order — the sort by
    // lastActivity is a stable no-op here since every lastActivity differs by
    // index only through `units.length`, which is 1 for all, so fall back to
    // asserting via materialId presence/absence and relative catalog order
    // using the unsorted set (all inputs here have equal sort weight of "1"
    // element, so summarize's lastPlayedAt is identical across all — assert
    // set membership + absence of the failed id).
    expect(result).toHaveLength(19);
    expect(result.map((r) => r.materialId)).not.toContain(`plex:m${FAIL_INDEX}`);
    const expectedOrder = manyMaterials.map((m) => m.id).filter((id) => id !== `plex:m${FAIL_INDEX}`);
    expect(result.map((r) => r.materialId)).toEqual(expectedOrder);

    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0][0]).toBe('school.progress-summary.units-failed');
    expect(warnCalls[0][1]).toMatchObject({ materialId: `plex:m${FAIL_INDEX}`, error: 'boom' });
  });
});
