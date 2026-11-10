import { describe, it, expect } from 'vitest';
import { filterMode } from './filterMode.js';

const ready = { ready: true, level: 'machine' };
describe('filterMode', () => {
  it('certified title filters by default', () => {
    expect(filterMode({ search: '', certification: ready, status: 'ready' })).toEqual({ fetch: true, enabled: true, reason: 'certified' });
  });
  it('uncertified title does not filter by default', () => {
    expect(filterMode({ search: '', certification: { ready: false, level: 'provisional' }, status: 'ready' }))
      .toEqual({ fetch: true, enabled: false, reason: 'uncertified' });
  });
  it('?filter=0 forces off and skips the fetch', () => {
    expect(filterMode({ search: '?filter=0', certification: ready, status: 'ready' })).toEqual({ fetch: false, enabled: false, reason: 'forced-off' });
  });
  it('?filter=1 forces on even when uncertified', () => {
    expect(filterMode({ search: '?filter=1', certification: { ready: false }, status: 'ready' })).toEqual({ fetch: true, enabled: true, reason: 'forced-on' });
  });
  it('no data and loading never enable', () => {
    expect(filterMode({ search: '', certification: null, status: 'none' })).toMatchObject({ enabled: false, reason: 'no-data' });
    expect(filterMode({ search: '?filter=1', certification: null, status: 'none' })).toMatchObject({ enabled: false, reason: 'no-data' });
    expect(filterMode({ search: '', certification: null, status: 'loading' })).toMatchObject({ fetch: true, enabled: false, reason: 'loading' });
  });
});

describe('filterMode with a host force', () => {
  it('force "on" behaves as ?filter=1 on an uncertified title', () => {
    expect(filterMode({ certification: { ready: false }, status: 'ready', force: 'on' })).toEqual({ fetch: true, enabled: true, reason: 'forced-on' });
  });
  it('force "on" still waits for the data, and ?filter=0 still wins', () => {
    expect(filterMode({ status: 'loading', force: 'on' }).enabled).toBe(false);
    expect(filterMode({ search: '?filter=0', status: 'ready', force: 'on' }).enabled).toBe(false);
  });
});
