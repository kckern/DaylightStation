import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));

import { primeApiResource, peekApiResource, resetApiResourceCache, isApiResourceFresh } from '../../lib/hooks/useApiResource.js';
import { refreshHealthResources, showCommittedFoodRows, healthDayPath, unavailableError } from './healthResources.js';

describe('refreshHealthResources', () => {
  beforeEach(() => resetApiResourceCache());

  it('marks day resources stale but leaves the dashboard alone', () => {
    // /dashboard re-aggregates two years of history (~2 s of server work that
    // stalls every other request). A food write does not change what Today
    // shows from it, so a write must not re-request it.
    primeApiResource(healthDayPath('2026-09-23'), { items: [] });
    primeApiResource('api/v1/health/dashboard', { today: {} });
    refreshHealthResources();
    expect(isApiResourceFresh(healthDayPath('2026-09-23'))).toBe(false);
    expect(isApiResourceFresh('api/v1/health/dashboard')).toBe(true);
  });
});

describe('showCommittedFoodRows', () => {
  beforeEach(() => resetApiResourceCache());

  it('appends a committed row to its own day', () => {
    primeApiResource(healthDayPath('2026-09-23'), { date: '2026-09-23', items: [{ uuid: 'a', date: '2026-09-23' }], revision: 5 });
    showCommittedFoodRows([{ uuid: 'b', name: 'Spinach', date: '2026-09-23', mealTime: 'evening' }]);
    expect(peekApiResource(healthDayPath('2026-09-23')).items.map(row => row.uuid)).toEqual(['a', 'b']);
  });

  it('does not duplicate a row the day already holds', () => {
    primeApiResource(healthDayPath('2026-09-23'), { items: [{ uuid: 'b', date: '2026-09-23' }] });
    showCommittedFoodRows([{ uuid: 'b', date: '2026-09-23' }]);
    expect(peekApiResource(healthDayPath('2026-09-23')).items).toHaveLength(1);
  });

  it('files each row under its own date and ignores rows without one', () => {
    primeApiResource(healthDayPath('2026-09-22'), { items: [] });
    primeApiResource(healthDayPath('2026-09-23'), { items: [] });
    showCommittedFoodRows([{ uuid: 'y', date: '2026-09-22' }, { uuid: 'n' }]);
    expect(peekApiResource(healthDayPath('2026-09-22')).items.map(row => row.uuid)).toEqual(['y']);
    expect(peekApiResource(healthDayPath('2026-09-23')).items).toEqual([]);
  });
});

describe('unavailableError', () => {
  const error = new Error('HTTP 502: Bad Gateway');
  it('is the error only when there is nothing on screen to keep', () => {
    expect(unavailableError({ data: null, error })).toBe(error);
    expect(unavailableError({ data: { weight: 172 }, error })).toBeNull();
    expect(unavailableError({ data: [], error })).toBeNull();
    expect(unavailableError({ data: null, error: null })).toBeNull();
  });
});
