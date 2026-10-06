import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { useScreenRegistry, mergeRegistryNames, registryLagsLiveNames } from './useScreenRegistry.js';
import { HouseApiError } from './houseApi.js';

let captured;
function Probe({ api }) {
  captured = useScreenRegistry({ api, pollMs: 0 });
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

  it('reports an unwired registry (501) as unavailable rather than broken', async () => {
    const api = { listScreens: vi.fn(async () => { throw new HouseApiError('no', { status: 501 }); }) };
    render(<Probe api={api} />);
    await waitFor(() => expect(captured.loaded).toBe(true));
    expect(captured.available).toBe(false);
    expect(captured.error).toBe(null);
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
