// Addendum items 5 and 6 (2026-11-26) on a start-page tile.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
vi.mock("../logging/mediaLog.js", () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});
import { HomeTile } from "./HomeTile.jsx";
import { FleetContext } from "../fleet/FleetProvider.jsx";
import { PeekContext } from "../peek/PeekContext.js";
import { DispatchContext } from "../cast/DispatchProvider.jsx";
import { NavContext } from "../shell/navContext.js";

const entries = {};
const fleet = {
  devices: [{ id: 'office-tv', name: 'Office Screen' }], identity: { deviceId: 'browser:me' },
  store: { getEntry: (id) => entries[id] ?? null, subscribeAll: () => () => {}, subscribeDevice: () => () => {} },
};
const transport = { pause: vi.fn(async () => ({ ok: true })), play: vi.fn(async () => ({ ok: true })) };
const push = vi.fn();
const onPlay = vi.fn();

function mount(outcomes = new Map()) {
  return render(
    <MantineProvider>
      <NavContext.Provider value={{ push }}>
        <FleetContext.Provider value={fleet}>
          <PeekContext.Provider value={{ getController: () => ({ transport }) }}>
            <DispatchContext.Provider value={{ outcomes }}>
              <HomeTile item={{ id: 'plex:1', title: 'Hospital', itemType: 'leaf' }} testId="tile" onPlay={onPlay} onVerb={vi.fn()} meta="Now on Office Screen" />
            </DispatchContext.Provider>
          </PeekContext.Provider>
        </FleetContext.Provider>
      </NavContext.Provider>
    </MantineProvider>,
  );
}

beforeEach(() => { vi.clearAllMocks(); for (const k of Object.keys(entries)) delete entries[k]; });

describe('HomeTile', () => {
  it('an item on a screen reads "On <screen>" and its disc pauses it there, never a fresh play', () => {
    entries['office-tv'] = { snapshot: { state: 'playing', currentItem: { contentId: 'plex:1' } } };
    mount();
    expect(screen.getByTestId('tile-on')).toHaveTextContent('On Office Screen');
    expect(screen.queryByText('Now on Office Screen')).toBeNull();
    const disc = screen.getByTestId('tile-play');
    expect(disc).toHaveAccessibleName('Pause Hospital on Office Screen');
    fireEvent.click(disc);
    expect(transport.pause).toHaveBeenCalledTimes(1);
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('its menu opens that screen\'s controls', async () => {
    entries['office-tv'] = { snapshot: { state: 'paused', currentItem: { contentId: 'plex:1' } } };
    mount();
    expect(screen.getByTestId('tile-play')).toHaveAccessibleName('Resume Hospital on Office Screen');
    fireEvent.click(screen.getByTestId('tile-more'));
    fireEvent.click(await screen.findByTestId('tile-verb-openScreen'));
    expect(push).toHaveBeenCalledWith('peek', { deviceId: 'office-tv' });
  });

  it('only this tile\'s disc spins while its start is in flight', () => {
    mount(new Map([['a', { attemptId: 'a', targetId: 'office-tv', distance: 'far', kind: 'play', phase: 'running', status: 'running', item: { contentId: 'plex:1' } }]]));
    expect(screen.getByTestId('tile-play')).toHaveAttribute('data-busy', 'true');
    expect(screen.getByTestId('tile-play')).toBeDisabled();
    expect(screen.getByTestId('tile-picture')).not.toBeDisabled();
  });

  it('nothing on a screen: a plain ▶ that plays', () => {
    mount();
    expect(screen.queryByTestId('tile-on')).toBeNull();
    fireEvent.click(screen.getByTestId('tile-play'));
    expect(onPlay).toHaveBeenCalledTimes(1);
  });
});
