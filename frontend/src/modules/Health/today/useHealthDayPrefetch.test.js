import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const prefetchApiResources = vi.fn(() => 0);
vi.mock('../../../lib/hooks/useApiResource.js', () => ({
  prefetchApiResources: (...args) => prefetchApiResources(...args), peekApiResource: () => undefined,
}));

import { prefetchOrder, useHealthDayPrefetch } from './useHealthDayPrefetch.js';

describe('prefetchOrder', () => {
  it('fans out nearest-first, earlier side first by default, never past today', () => {
    expect(prefetchOrder('2026-09-20', '2026-09-22', -1, 3))
      .toEqual(['2026-09-19', '2026-09-21', '2026-09-18', '2026-09-22', '2026-09-17']);
  });
  it('moving forward puts the later side first at each distance', () => {
    expect(prefetchOrder('2026-09-10', '2026-09-22', 1, 2))
      .toEqual(['2026-09-11', '2026-09-09', '2026-09-12', '2026-09-08']);
  });
  it('from today, only past days', () => {
    expect(prefetchOrder('2026-09-22', '2026-09-22', -1, 7)).toHaveLength(7);
  });
});

describe('useHealthDayPrefetch', () => {
  beforeEach(() => { prefetchApiResources.mockClear(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-22T12:00:00')); });
  afterEach(() => vi.useRealTimers());

  it('waits for the viewed day, then queues neighbours nearest-first with shortlists early', () => {
    const { rerender } = renderHook(({ ready }) => useHealthDayPrefetch('2026-09-20', { ready }), { initialProps: { ready: false } });
    expect(prefetchApiResources).not.toHaveBeenCalled();
    rerender({ ready: true });
    const paths = prefetchApiResources.mock.calls[0][0];
    expect(paths.slice(0, 3)).toEqual([
      'api/v1/health/day?date=2026-09-19',
      'api/v1/health/nutrition/pending?date=2026-09-19',
      'api/v1/health/nutrition/observations?date=2026-09-19',
    ]);
    expect(paths[3]).toBe('api/v1/health/day?date=2026-09-21');
    expect(paths.findIndex(p => p.includes('catalog/suggest'))).toBe(6);
    expect(paths).toContain('api/v1/health/day?date=2026-09-13');
    expect(paths.every(p => typeof p === 'string' && !p.includes(','))).toBe(true);
    expect(paths.some(p => p.includes('date=2026-09-23'))).toBe(false);
  });

  it('a move re-queues around the new day', () => {
    const { rerender } = renderHook(({ date }) => useHealthDayPrefetch(date), { initialProps: { date: '2026-09-20' } });
    rerender({ date: '2026-09-19' });
    expect(prefetchApiResources.mock.calls.at(-1)[0][0]).toBe('api/v1/health/day?date=2026-09-18');
  });
});
