// Addendum item 8 (2026-11-26): Space = play/pause the current session.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
vi.mock("../logging/mediaLog.js", () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});
let aim = { targetIds: [] };
vi.mock("../cast/useCastTarget.js", () => ({ useCastTarget: () => aim }));
import { useSpaceToggle, spaceTarget } from "./useSpaceToggle.js";
import { LocalSessionContext } from "../session/LocalSessionContext.js";
import { PeekContext } from "../peek/PeekContext.js";
import { FleetContext } from "../fleet/FleetProvider.jsx";

const entries = {};
const store = { getEntry: (id) => entries[id] ?? null };
const screenTransport = { pause: vi.fn(async () => ({ ok: true })), play: vi.fn(async () => ({ ok: true })) };
let localSnap = null;
const local = { getSnapshot: () => localSnap, transport: { pause: vi.fn(), play: vi.fn() } };

function Shell() { useSpaceToggle(); return <><input data-testid="box" /><button type="button" data-testid="btn">x</button><div data-testid="page" tabIndex={-1} /></>; }
function mount() {
  return render(
    <FleetContext.Provider value={{ store, devices: [] }}>
      <PeekContext.Provider value={{ getController: () => ({ transport: screenTransport }) }}>
        <LocalSessionContext.Provider value={{ controller: local }}>
          <Shell />
        </LocalSessionContext.Provider>
      </PeekContext.Provider>
    </FleetContext.Provider>,
  );
}
const space = (target) => fireEvent.keyDown(target, { key: ' ', code: 'Space' });

beforeEach(() => {
  vi.clearAllMocks();
  aim = { targetIds: [] };
  localSnap = null;
  for (const k of Object.keys(entries)) delete entries[k];
});

describe('spaceTarget', () => {
  it('the aimed screen while it plays or is paused, else this device; never a start', () => {
    const entryFor = (id) => ({ tv: { snapshot: { state: 'playing', currentItem: {} } }, idle: { snapshot: { state: 'idle' } } })[id] ?? null;
    expect(spaceTarget({ aimIds: ['tv'], entryFor })).toEqual({ target: 'screen', deviceId: 'tv', action: 'pause' });
    expect(spaceTarget({ aimIds: ['idle'], entryFor, localSnapshot: { state: 'paused', currentItem: {} } })).toEqual({ target: 'local', action: 'play' });
    expect(spaceTarget({ aimIds: ['idle'], entryFor, localSnapshot: { state: 'idle', currentItem: {} } })).toBeNull();
    expect(spaceTarget({ entryFor, localSnapshot: { state: 'ended', currentItem: {} } })).toBeNull();
    expect(spaceTarget({ entryFor })).toBeNull();
  });
});

describe('useSpaceToggle', () => {
  it('pauses the aimed screen that is playing', () => {
    aim = { targetIds: ['office-tv'] };
    entries['office-tv'] = { snapshot: { state: 'playing', currentItem: { contentId: 'plex:1' } } };
    const view = mount();
    space(view.getByTestId('page'));
    expect(screenTransport.pause).toHaveBeenCalledTimes(1);
    expect(local.transport.pause).not.toHaveBeenCalled();
  });

  it('else plays / pauses this device', () => {
    localSnap = { state: 'paused', currentItem: { contentId: 'plex:2' } };
    const view = mount();
    space(view.getByTestId('page'));
    expect(local.transport.play).toHaveBeenCalledTimes(1);
  });

  it('does nothing while typing in a field or on a button Space activates', () => {
    localSnap = { state: 'playing', currentItem: { contentId: 'plex:2' } };
    const view = mount();
    space(view.getByTestId('box'));
    space(view.getByTestId('btn'));
    expect(local.transport.pause).not.toHaveBeenCalled();
  });

  it('never starts anything: nothing playing or paused, Space is left to the page', () => {
    localSnap = { state: 'idle', currentItem: { contentId: 'plex:2' } };
    const view = mount();
    const event = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
    view.getByTestId('page').dispatchEvent(event);
    expect(local.transport.play).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
