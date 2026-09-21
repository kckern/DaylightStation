import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const snapshots = new Map([
  ['playing', { snapshot: { state: 'playing' }, offline: false }],
  ['paused', { snapshot: { state: 'paused' }, offline: false }],
  ['offline', { snapshot: { state: 'playing' }, offline: true }],
]);
const store = {
  subscribeAll: vi.fn(() => () => {}),
  getAll: vi.fn(() => snapshots),
};
vi.mock('./useFleetContext.js', () => ({
  useFleetContext: () => ({ store, devices: [{ id: 'playing' }, { id: 'paused' }, { id: 'offline' }] }),
}));

import { useFleetSummary } from './useFleetSummary.js';

describe('useFleetSummary', () => {
  it('counts online playing and paused snapshots separately', () => {
    const { result } = renderHook(() => useFleetSummary());
    expect(result.current).toMatchObject({ playing: 1, paused: 1, active: 2, total: 3 });
  });
});
