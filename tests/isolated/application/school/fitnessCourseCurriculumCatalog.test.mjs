import { describe, expect, it, vi } from 'vitest';
import { FitnessCourseCurriculumCatalog } from '#apps/school/FitnessCourseCurriculumCatalog.mjs';

const authored = {
  schema: 'school.fitness-course/v1', work: 'bike-basics', title: 'Bike Basics', subject: 'skills',
  source: { adapter: 'plex', showId: '700' },
};
const source = { items: [{ id: '101', title: 'Ride', duration: 600 }] };

const base = () => ({
  listWorks: vi.fn(async () => ({ items: [{ id: 'skills/bike-basics', subject: 'skills', work: 'bike-basics', raw: authored }], errors: [] })),
  listUnits: vi.fn(async () => ({ items: [], errors: [] })),
  listDocuments: vi.fn(async () => ({ items: [], errors: [] })),
  listManifests: vi.fn(async () => ({ items: [], errors: [] })),
  getDocument: vi.fn(), getManifest: vi.fn(),
});

describe('FitnessCourseCurriculumCatalog', () => {
  it('projects a provider show into the ordinary School work/unit catalog and saves last-known-good state', async () => {
    const snapshots = { get: vi.fn(), put: vi.fn(async () => {}) };
    const catalog = new FitnessCourseCurriculumCatalog({
      baseCatalog: base(), sourceProvider: { getPlayableEpisodes: vi.fn(async () => source) },
      projectionStore: snapshots, clock: () => 1,
    });
    const [works, units] = await Promise.all([catalog.listWorks(), catalog.listUnits()]);
    expect(works.items[0].raw).toMatchObject({ work: 'bike-basics', medium: 'app' });
    expect(units.items[0].raw).toMatchObject({ unitId: 'bike-basics.101', activity: { provider: 'fitness' } });
    expect(snapshots.put).toHaveBeenCalledWith('bike-basics', expect.objectContaining({ courseRevision: expect.any(String) }));
  });

  it('uses the last-known-good projection during a Fitness source outage', async () => {
    const healthySnapshots = { get: vi.fn(), put: vi.fn(async (_work, projection) => { healthySnapshots.saved = projection; }) };
    const healthy = new FitnessCourseCurriculumCatalog({
      baseCatalog: base(), sourceProvider: { getPlayableEpisodes: vi.fn(async () => source) },
      projectionStore: healthySnapshots, clock: () => 1,
    });
    await healthy.listUnits();

    const catalog = new FitnessCourseCurriculumCatalog({
      baseCatalog: base(), sourceProvider: { getPlayableEpisodes: vi.fn(async () => { throw new Error('Plex offline'); }) },
      projectionStore: { get: vi.fn(async () => healthySnapshots.saved) }, clock: () => 1,
      logger: { info: vi.fn(), warn: vi.fn() },
    });
    const units = await catalog.listUnits();
    expect(units.errors).toEqual([]);
    expect(units.items[0].raw.unitId).toBe('bike-basics.101');
  });

  it('reports an unavailable authored course when neither provider nor snapshot can supply it', async () => {
    const catalog = new FitnessCourseCurriculumCatalog({
      baseCatalog: base(), sourceProvider: null, projectionStore: { get: vi.fn(async () => null) }, clock: () => 1,
      logger: { info: vi.fn(), warn: vi.fn() },
    });
    const works = await catalog.listWorks();
    expect(works.items).toEqual([]);
    expect(works.errors[0]).toMatch(/Fitness course unavailable/);
  });
});
