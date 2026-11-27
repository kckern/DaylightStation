// STEER.1a/AC4 — the handle for the screen most recently sent to or steered.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const push = vi.fn();
const nav = { push, view: 'home', params: {} };
vi.mock("./NavProvider.jsx", () => ({ useNav: () => nav }));
vi.mock("../logging/mediaLog.js", () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

const entries = {};
const devices = [{ id: 'tv', name: 'Living Room TV' }, { id: 'me', name: 'This phone', isLocal: true }];
const store = {
  getEntry: (id) => entries[id] ?? null,
  subscribeDevice: () => () => {},
};
vi.mock("../fleet/useFleetContext.js", () => ({ useFleetContext: () => ({ store, devices }) }));
vi.mock("../fleet/useDevice.js", () => ({
  useDevice: (id) => ({ device: devices.find((d) => d.id === id) ?? null, entry: entries[id] ?? null }),
}));
let cast = { targetIds: [] };
vi.mock("../cast/useCastTarget.js", () => ({ useCastTarget: () => cast }));

import { PeekContext } from "../peek/PeekContext.js";
import { ScreenHandle } from "./ScreenHandle.jsx";
import { handleStops } from "./handleStop.js";

const pause = vi.fn(async () => ({ ok: true }));
const play = vi.fn(async () => ({ ok: true }));
const stop = vi.fn(async () => ({ ok: true }));
const peek = { getController: () => ({ transport: { pause, play, stop } }), lastSteeredId: null };

function mount(overrides = {}) {
  return render(<PeekContext.Provider value={{ ...peek, ...overrides }}><ScreenHandle /></PeekContext.Provider>, { wrapper: MantineProvider });
}

beforeEach(() => {
  vi.clearAllMocks();
  nav.view = 'home'; nav.params = {};
  cast = { targetIds: [] };
  for (const k of Object.keys(entries)) delete entries[k];
  entries.tv = { snapshot: { state: 'playing', currentItem: { contentId: 'plex:1', title: 'Bluey' } } };
});

describe('ScreenHandle Stop (owner ruling 2026-11-27)', () => {
  it('is optimistic: the handle goes at once and stays gone while the screen still reports the stopped item', async () => {
    let finish;
    stop.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
    cast = { targetIds: ['tv'] };
    const view = mount();
    fireEvent.click(screen.getByTestId('screen-handle-stop'));
    expect(screen.queryByTestId('screen-handle')).toBeNull();
    expect(stop).toHaveBeenCalledWith({ keepMusic: false });
    await act(async () => { finish({ ok: true }); });
    // The fleet still shows it paused with the item: no "Paused · Resume" leftover.
    entries.tv = { snapshot: { state: 'paused', currentItem: { contentId: 'plex:1', title: 'Bluey' } } };
    view.rerender(<PeekContext.Provider value={peek}><ScreenHandle /></PeekContext.Provider>);
    expect(screen.queryByTestId('screen-handle')).toBeNull();
    handleStops.dismiss('tv');
  });

  it('rolls back on error: the bar returns as "Couldn\'t stop on <screen>" with Retry', async () => {
    stop.mockRejectedValueOnce(new Error('ack timeout'));
    cast = { targetIds: ['tv'] };
    mount();
    await act(async () => { fireEvent.click(screen.getByTestId('screen-handle-stop')); });
    expect(await screen.findByTestId('screen-handle-state')).toHaveTextContent("Couldn't stop on Living Room TV");
    await act(async () => { fireEvent.click(screen.getByTestId('screen-handle-stop-retry')); });
    expect(stop).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('screen-handle-stop-retry')).toBeNull();
    handleStops.dismiss('tv');
  });
});

describe('ScreenHandle', () => {
  it('shows nothing when no screen was sent to or steered', () => {
    const { container } = mount();
    expect(container.querySelector('[data-testid="screen-handle"]')).toBeNull();
  });

  it('names the aimed screen playing something and pauses it in one tap', () => {
    cast = { targetIds: ['tv'] };
    mount();
    expect(screen.getByTestId('screen-handle-title')).toHaveTextContent('▶ Bluey · Living Room TV');
    expect(screen.getByTestId('screen-handle-state')).toHaveTextContent('Playing');
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
    expect(container.querySelector('[data-testid="screen-handle"]')).toBeNull();
  });

  it('is absent when the screen is idle or is this device itself', () => {
    entries.tv.snapshot.state = 'idle';
    const { container, rerender } = mount({ lastSteeredId: 'tv' });
    expect(container.querySelector('[data-testid="screen-handle"]')).toBeNull();
    entries.me = { snapshot: { state: 'playing', currentItem: { title: 'Mine' } } };
    rerender(<PeekContext.Provider value={{ ...peek, lastSteeredId: 'me' }}><ScreenHandle /></PeekContext.Provider>);
    expect(container.querySelector('[data-testid="screen-handle"]')).toBeNull();
  });
});
