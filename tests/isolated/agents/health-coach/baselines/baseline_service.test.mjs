import { describe, it, expect, vi } from 'vitest';
import { PersonalBaselineService } from '../../../../../backend/src/3_applications/agents/health-coach/services/PersonalBaselineService.mjs';

const FROZEN_NOW = () => new Date('2026-05-07T12:00:00Z');

function makeSvc({ workoutAdapter, mealAdapter, weighinAdapter, dataService, cacheTtlMs } = {}) {
  return new PersonalBaselineService({
    adapters: { workout: workoutAdapter, meal: mealAdapter, weigh_in: weighinAdapter },
    dataService,
    cacheTtlMs,
    now: FROZEN_NOW,
  });
}

describe('PersonalBaselineService.getBaselines', () => {
  it('returns cached baselines when fresh (under TTL)', async () => {
    const cached = {
      computed_at: '2026-05-07T08:00:00Z',  // 4h ago, fresh
      fitness: { n: 0 }, nutrition: { n: 0 }, weight: { n: 0 },
    };
    const dataService = { user: { read: vi.fn(async () => cached), write: vi.fn() } };
    const workoutAdapter = { list: vi.fn(async () => ({ events: [] })) };
    const svc = makeSvc({ workoutAdapter, dataService });
    const r = await svc.getBaselines({ userId: 'kckern' });
    expect(r).toBe(cached);
    expect(workoutAdapter.list).not.toHaveBeenCalled();
    expect(dataService.user.write).not.toHaveBeenCalled();
  });

  it('recomputes when cache is stale', async () => {
    const stale = { computed_at: '2026-05-01T08:00:00Z', fitness: {} };  // ~6 days old
    const dataService = {
      user: { read: vi.fn(async () => stale), write: vi.fn(async () => {}) },
    };
    const workoutAdapter = { list: vi.fn(async () => ({ events: [] })) };
    const mealAdapter    = { list: vi.fn(async () => ({ events: [] })) };
    const weighinAdapter = { list: vi.fn(async () => ({ events: [] })) };
    const svc = makeSvc({ workoutAdapter, mealAdapter, weighinAdapter, dataService });
    const r = await svc.getBaselines({ userId: 'kckern' });
    expect(workoutAdapter.list).toHaveBeenCalled();
    expect(mealAdapter.list).toHaveBeenCalled();
    expect(weighinAdapter.list).toHaveBeenCalled();
    expect(dataService.user.write).toHaveBeenCalledWith('profile/baselines', expect.any(Object), 'kckern');
    expect(r.computed_at).toBe('2026-05-07T12:00:00.000Z');
  });

  it('recomputes when no cache exists', async () => {
    const dataService = {
      user: { read: vi.fn(async () => null), write: vi.fn(async () => {}) },
    };
    const workoutAdapter = { list: vi.fn(async () => ({ events: [
      {
        domain_extras: { kind_canonical: 'run' },
        scalars: { duration_min: 30, hr_avg: 148, hr_max: 170, distance_mi: 4 },
      },
    ] })) };
    const mealAdapter    = { list: vi.fn(async () => ({ events: [] })) };
    const weighinAdapter = { list: vi.fn(async () => ({ events: [] })) };
    const svc = makeSvc({ workoutAdapter, mealAdapter, weighinAdapter, dataService });
    const r = await svc.getBaselines({ userId: 'kckern' });
    expect(r.fitness.n).toBe(1);
    expect(r.fitness.run.median_duration_min).toBe(30);
    expect(r.computed_at).toBe('2026-05-07T12:00:00.000Z');
  });

  it('survives missing adapters (returns empty domain blocks)', async () => {
    const dataService = {
      user: { read: vi.fn(async () => null), write: vi.fn(async () => {}) },
    };
    const svc = new PersonalBaselineService({
      adapters: {},  // no adapters
      dataService,
      now: FROZEN_NOW,
    });
    const r = await svc.getBaselines({ userId: 'kckern' });
    expect(r.fitness.n).toBe(0);
    expect(r.nutrition.n).toBe(0);
    expect(r.weight.n).toBe(0);
  });

  it('throws when userId missing', async () => {
    const dataService = { user: { read: vi.fn(), write: vi.fn() } };
    const svc = new PersonalBaselineService({ adapters: {}, dataService, now: FROZEN_NOW });
    await expect(svc.getBaselines({})).rejects.toThrow(/userId/);
  });
});
