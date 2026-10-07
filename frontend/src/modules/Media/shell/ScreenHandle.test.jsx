// STEER.1a/AC4 — the handle for the screen most recently sent to or steered.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const push = vi.fn();
const nav = { push, view: 'home', params: {} };
vi.mock('./NavProvider.jsx', () => ({ useNav: () => nav }));
vi.mock('../logging/mediaLog.js', () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

const entries = {};
const devices = [{ id: 'tv', name: 'Living Room TV' }, { id: 'me', name: 'This phone', isLocal: true }];
const store = {
  getEntry: (id) => entries[id] ?? null,
  subscribeDevice: () => () => {},
};
vi.mock('../fleet/useFleetContext.js', () => ({ useFleetContext: () => ({ store, devices }) }));
vi.mock('../fleet/useDevice.js', () => ({
  useDevice: (id) => ({ device: devices.find((d) => d.id === id) ?? null, entry: entries[id] ?? null }),
}));
let cast = { targetIds: [] };
vi.mock('../cast/useCastTarget.js', () => ({ useCastTarget: () => cast }));

import { PeekContext } from '../peek/PeekContext.js';
import { ScreenHandle } from './ScreenHandle.jsx';

const pause = vi.fn(async () => ({ ok: true }));
const play = vi.fn(async () => ({ ok: true }));
const peek = { getController: () => ({ transport: { pause, play } }), lastSteeredId: null };

function mount(overrides = {}) {
  return render(<PeekContext.Provider value={{ ...peek, ...overrides }}><ScreenHandle /></PeekContext.Provider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  nav.view = 'home'; nav.params = {};
  cast = { targetIds: [] };
  for (const k of Object.keys(entries)) delete entries[k];
  entries.tv = { snapshot: { state: 'playing', currentItem: { contentId: 'plex:1', title: 'Bluey' } } };
});

describe('ScreenHandle', () => {
  it('shows nothing when no screen was sent to or steered', () => {
    const { container } = mount();
    expect(container).toBeEmptyDOMElement();
  });

  it('names the aimed screen playing something and pauses it in one tap', () => {
    cast = { targetIds: ['tv'] };
    mount();
    expect(screen.getByTestId('screen-handle-name')).toHaveTextContent('Living Room TV · Playing');
    expect(screen.getByTestId('screen-handle')).toHaveTextContent('Bluey');
    fireEvent.click(screen.getByTestId('screen-handle-toggle'));
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('offers Resume while that screen is paused', () => {
    entries.tv.snapshot.state = 'paused';
    mount({ lastSteeredId: 'tv' });
    expect(screen.getByTestId('screen-handle-toggle')).toHaveAccessibleName('Resume Living Room TV');
    fireEvent.click(screen.getByTestId('screen-handle-toggle'));
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('opens that screen\'s full controls from the title, and steps aside while they are open', () => {
    mount({ lastSteeredId: 'tv' });
    fireEvent.click(screen.getByTestId('screen-handle-open'));
    expect(push).toHaveBeenCalledWith('peek', { deviceId: 'tv' });
  });

  it('does not duplicate the controls while that screen\'s Remote is open', () => {
    nav.view = 'peek'; nav.params = { deviceId: 'tv' };
    const { container } = mount({ lastSteeredId: 'tv' });
    expect(container).toBeEmptyDOMElement();
  });

  it('is absent when the screen is idle or is this device itself', () => {
    entries.tv.snapshot.state = 'idle';
    const { container, rerender } = mount({ lastSteeredId: 'tv' });
    expect(container).toBeEmptyDOMElement();
    entries.me = { snapshot: { state: 'playing', currentItem: { title: 'Mine' } } };
    rerender(<PeekContext.Provider value={{ ...peek, lastSteeredId: 'me' }}><ScreenHandle /></PeekContext.Provider>);
    expect(container).toBeEmptyDOMElement();
  });
});
