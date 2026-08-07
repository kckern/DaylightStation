/**
 * GetMaterialUnits × snapshot cache (material-cache mini-wave): the disk
 * snapshot seeds the in-memory material cache at construction, past-TTL
 * entries serve stale-while-revalidate (never block on the provider), and a
 * beyond-bound entry blocks on a real fetch. Progress folding is out of
 * scope here — those paths are stubbed inert.
 */
import { describe, it, expect, vi } from 'vitest';
import { GetMaterialUnits } from './GetMaterialUnits.mjs';

const HOUR = 3_600_000;

const makeFull = (title) => ({
  id: 'm1', title, poster: null, source: 'media-album', medium: 'audio',
  durationMs: 10, unitCount: 1,
  units: [{ id: 'u1', index: 1, title, durationMs: 10, group: null }],
});

function makeUseCase({ snapshotAt, adapter }) {
  const snapshot = {
    load: () => new Map(snapshotAt != null
      ? [['m1', { full: makeFull('From snapshot'), at: snapshotAt }]]
      : []),
    put: vi.fn(),
  };
  const useCase = new GetMaterialUnits({
    catalog: {
      findMaterial: async () => ({
        entry: { source: 's', label: 'Test shelf' },
        material: { id: 'm1', title: 'Catalog title', poster: null, category: 'listening' },
      }),
    },
    sources: { s: adapter },
    config: { quiz_pass_percent: 80, completion_threshold_percent: 90 },
    progressStore: { enrich: (ordered) => ordered.map(() => ({})) },
    bankIndex: { byUnit: () => null },
    attemptsReader: { read: () => [] },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    snapshot,
  });
  return { useCase, snapshot };
}

describe('GetMaterialUnits snapshot seeding', () => {
  it('a fresh (within-TTL) seed serves without touching the provider', async () => {
    const adapter = { getMaterial: vi.fn() };
    const { useCase } = makeUseCase({ snapshotAt: Date.now() - HOUR / 2, adapter });
    const { material } = await useCase.execute({ materialId: 'm1' });
    expect(material.title).toBe('From snapshot');
    expect(adapter.getMaterial).not.toHaveBeenCalled();
  });

  it('a stale (past-TTL, within-bound) seed serves immediately and revalidates in the background', async () => {
    let resolveFetch;
    const adapter = { getMaterial: vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; })) };
    const { useCase, snapshot } = makeUseCase({ snapshotAt: Date.now() - 2 * HOUR, adapter });

    // Serves the stale seed NOW — the provider promise is still pending.
    const { material } = await useCase.execute({ materialId: 'm1' });
    expect(material.title).toBe('From snapshot');
    expect(adapter.getMaterial).toHaveBeenCalledTimes(1);

    // The background refresh lands: snapshot updated, next call serves fresh.
    resolveFetch(makeFull('Fresh from provider'));
    await vi.waitFor(() => expect(snapshot.put).toHaveBeenCalledTimes(1));
    expect(snapshot.put.mock.calls[0][0]).toBe('m1');
    expect(snapshot.put.mock.calls[0][1].title).toBe('Fresh from provider');
    const again = await useCase.execute({ materialId: 'm1' });
    expect(again.material.title).toBe('Fresh from provider');
    expect(adapter.getMaterial).toHaveBeenCalledTimes(1); // fresh cache — no second fetch
  });

  it('a failed background revalidation keeps serving the stale seed (warn, never throw)', async () => {
    const adapter = { getMaterial: vi.fn(() => Promise.reject(new Error('plex down'))) };
    const { useCase } = makeUseCase({ snapshotAt: Date.now() - 2 * HOUR, adapter });
    const { material } = await useCase.execute({ materialId: 'm1' });
    expect(material.title).toBe('From snapshot');
    await new Promise((resolve) => { setTimeout(resolve, 0); }); // rejection settles handled
    const again = await useCase.execute({ materialId: 'm1' });
    expect(again.material.title).toBe('From snapshot');
  });

  it('a beyond-bound (>24h) seed blocks on a real fetch instead of serving ancient units', async () => {
    const adapter = { getMaterial: vi.fn(async () => makeFull('Fresh from provider')) };
    const { useCase } = makeUseCase({ snapshotAt: Date.now() - 25 * HOUR, adapter });
    const { material } = await useCase.execute({ materialId: 'm1' });
    expect(material.title).toBe('Fresh from provider');
  });

  it('no snapshot wired → plain cold fetch, and nothing explodes', async () => {
    const adapter = { getMaterial: vi.fn(async () => makeFull('Fresh from provider')) };
    const useCase = new GetMaterialUnits({
      catalog: {
        findMaterial: async () => ({
          entry: { source: 's', label: 'Test shelf' },
          material: { id: 'm1', title: 'Catalog title', poster: null, category: 'listening' },
        }),
      },
      sources: { s: adapter },
      config: { quiz_pass_percent: 80, completion_threshold_percent: 90 },
      progressStore: { enrich: (ordered) => ordered.map(() => ({})) },
      bankIndex: { byUnit: () => null },
      attemptsReader: { read: () => [] },
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    const { material } = await useCase.execute({ materialId: 'm1' });
    expect(material.title).toBe('Fresh from provider');
  });
});
