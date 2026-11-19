import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { useScreenRegistry, mergeRegistryNames, registryLagsLiveNames } from "./useScreenRegistry.js";
import { HouseApiError } from "./houseApi.js";

let captured;
function Probe({ api, pollMs = 0 }) {
  captured = useScreenRegistry({ api, pollMs });
  return <div data-testid="probe">{captured.screens.map((s) => s.name).join(',')}|{captured.available ? 'y' : 'n'}</div>;
}

describe('useScreenRegistry', () => {
  it('loads the household screen list and indexes it by id and by merged alias', async () => {
    const api = { listScreens: vi.fn(async () => ({
      screens: [{ id: 'fleet:livingroom-tv', name: 'Den TV', aliases: ['browser:old'] }],
      notSeenLately: [{ id: 'browser:gone', name: 'Old phone' }], retired: [],
    })) };
    render(<Probe api={api} />);
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('Den TV|y'));
    expect(captured.byId.get('fleet:livingroom-tv').name).toBe('Den TV');
    expect(captured.byId.get('browser:old').name).toBe('Den TV');
    expect(captured.byId.get('browser:gone').name).toBe('Old phone');
    await act(async () => { await captured.refresh(); });
    expect(api.listScreens).toHaveBeenCalledTimes(2);
  });

  it('keeps the newest screen list when an older request settles after StrictMode remount', async () => {
    const pending = [];
    const api = { listScreens: () => new Promise(resolve => pending.push(resolve)) };
    render(<React.StrictMode><Probe api={api} /></React.StrictMode>);
    expect(pending).toHaveLength(2);
    await act(async () => pending[1]({ screens: [{ id: 'den', name: 'Current name' }] }));
    await act(async () => pending[0]({ screens: [{ id: 'den', name: 'Old name' }] }));
    expect(screen.getByTestId('probe')).toHaveTextContent('Current name|y');
  });

  it('lets a slow registry read finish across ticks and still replaces it on explicit refresh', async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const pending = [];
    const api = { listScreens: vi.fn(() => new Promise(resolve => pending.push(resolve))) };
    const result = name => ({ screens: [{ id: 'den', name }] });
    try {
      render(<Probe api={api} pollMs={100} />);
      expect(pending).toHaveLength(1);
      await act(async () => vi.advanceTimersByTime(250));
      expect(pending).toHaveLength(1);

      visibility.mockReturnValue('visible');
      act(() => document.dispatchEvent(new Event('visibilitychange')));
      expect(pending).toHaveLength(2);
      await act(async () => vi.advanceTimersByTime(250));
      expect(pending).toHaveLength(2);
      await act(async () => pending[1](result('Current name')));
      expect(screen.getByTestId('probe')).toHaveTextContent('Current name|y');

      await act(async () => vi.advanceTimersByTime(100));
      expect(pending).toHaveLength(3);
      let refreshed;
      act(() => { refreshed = captured.refresh(); });
      expect(pending).toHaveLength(4);
      await act(async () => pending[2](result('Superseded name')));
      await act(async () => vi.advanceTimersByTime(100));
      expect(pending).toHaveLength(4);
      await act(async () => { pending[3](result('Renamed screen')); await refreshed; });
      await act(async () => pending[0](result('Original name')));
      expect(screen.getByTestId('probe')).toHaveTextContent('Renamed screen|y');
    } finally {
      visibility.mockRestore();
      vi.useRealTimers();
    }
  });

  it('retires a retained registry refresh when its API changes', async () => {
    const previous = { listScreens: vi.fn(async () => ({ screens: [{ id: 'den', name: 'Former name' }] })) };
    const current = { listScreens: vi.fn(async () => ({ screens: [{ id: 'den', name: 'Current name' }] })) };
    const { rerender } = render(<Probe api={previous} />);
    const formerRefresh = captured.refresh;
    rerender(<Probe api={current} />);
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('Current name|y'));
    await act(async () => formerRefresh());
    expect(previous.listScreens).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('probe')).toHaveTextContent('Current name|y');
  });

  it('reports an unwired registry (501) as unavailable rather than broken', async () => {
    const api = { listScreens: vi.fn(async () => { throw new HouseApiError('no', { status: 501 }); }) };
    render(<Probe api={api} />);
    await waitFor(() => expect(captured.loaded).toBe(true));
    expect(captured.available).toBe(false);
    expect(captured.error).toBe(null);
  });

  it('retains the last list after a transient error and clears it when the registry is unavailable', async () => {
    const saved = { id: 'fleet:den', name: 'Den TV', room: 'Den', aliases: ['browser:old'] };
    const api = { listScreens: vi.fn()
      .mockResolvedValueOnce({ screens: [saved], roomAdjacency: { Den: ['Kitchen'] } })
      .mockRejectedValueOnce(new HouseApiError('Temporary error', { status: 500 }))
      .mockRejectedValueOnce(new HouseApiError('Unavailable', { status: 501 }))
      .mockResolvedValueOnce({ screens: [saved] }) };
    render(<Probe api={api} />);
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('Den TV|y'));
    await act(async () => captured.refresh());
    expect(captured.byId.get('browser:old')).toBe(saved);
    expect(captured.roomAdjacency).toEqual({ Den: ['Kitchen'] });
    await act(async () => captured.refresh());
    expect(captured.available).toBe(false);
    expect(captured.screens).toEqual([]);
    expect(captured.byId.size).toBe(0);
    expect(captured.roomAdjacency).toEqual({});
    await act(async () => captured.refresh());
    expect(captured.available).toBe(true);
    expect(captured.byId.get('fleet:den')).toBe(saved);
  });
});

describe('mergeRegistryNames', () => {
  it('names configured and browser screens by the registry, with room and was-name', () => {
    const byId = new Map([
      ['fleet:livingroom-tv', { id: 'fleet:livingroom-tv', name: 'Den TV', room: 'Den', wasName: 'Living Room TV' }],
      ['browser:a', { id: 'browser:a', name: 'Kitchen tablet', room: null, wasName: null }],
    ]);
    const merged = mergeRegistryNames([
      { id: 'livingroom-tv', name: 'Living Room TV', location: 'Living Room' },
      { id: 'browser:a', name: 'Browser aaaa', type: 'browser' },
      { id: 'office-tv', name: 'Office' },
    ], byId);
    expect(merged[0]).toMatchObject({ name: 'Den TV', location: 'Den', wasName: 'Living Room TV', screenId: 'fleet:livingroom-tv' });
    expect(merged[1]).toMatchObject({ name: 'Kitchen tablet', wasName: null, screenId: 'browser:a' });
    expect(merged[2]).toMatchObject({ name: 'Office', screenId: 'fleet:office-tv' });
  });

  it('trusts a browser\'s live name over an older copy of the list, and says the copy is stale', () => {
    const byId = new Map([['browser:a', { id: 'browser:a', name: 'Hall phone', wasName: null }]]);
    const merged = mergeRegistryNames([{ id: 'browser:a', name: 'Den phone', liveName: 'Den phone', type: 'browser' }], byId);
    expect(merged[0].name).toBe('Den phone');
    expect(registryLagsLiveNames(merged, byId)).toBe(true);
    expect(registryLagsLiveNames([{ id: 'browser:a', screenId: 'browser:a', liveName: 'Hall phone' }], byId)).toBe(false);
  });
});
