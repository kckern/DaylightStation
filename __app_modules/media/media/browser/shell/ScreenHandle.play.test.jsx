// Addendum items 1 and 3 (2026-11-26): one bar follows the play to a screen.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const push = vi.fn();
const nav = { push, view: 'search', params: {} };
vi.mock("./NavProvider.jsx", () => ({ useNav: () => nav }));
vi.mock("../logging/mediaLog.js", () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});
const executeItemAction = vi.fn(async () => ({ ok: true }));
vi.mock("../actions/itemAction.js", async (orig) => ({ ...(await orig()), executeItemAction: (...a) => executeItemAction(...a) }));

const entries = {};
const devices = [{ id: 'office-tv', name: 'Office Screen', type: 'shield-tv' }];
const store = { getEntry: (id) => entries[id] ?? null, subscribeDevice: () => () => {} };
vi.mock("../fleet/useFleetContext.js", () => ({ useFleetContext: () => ({ store, devices }) }));
vi.mock("../fleet/useDevice.js", () => ({
  useDevice: (id) => ({ device: devices.find((d) => d.id === id) ?? null, entry: entries[id] ?? null }),
}));
vi.mock("../cast/useCastTarget.js", () => ({ useCastTarget: () => ({ targetIds: [] }) }));

import { PeekContext } from "../peek/PeekContext.js";
import { DispatchContext } from "../cast/DispatchProvider.jsx";
import { LocalSessionContext } from "../session/LocalSessionContext.js";
import { DispatchProgressTray } from "../cast/DispatchProgressTray.jsx";
import { ScreenHandle } from "./ScreenHandle.jsx";

const transport = { pause: vi.fn(async () => ({ ok: true })), play: vi.fn(async () => ({ ok: true })), skipNext: vi.fn(async () => ({ ok: true })), stop: vi.fn(async () => ({ ok: true })) };
const peek = { getController: () => ({ transport }), lastSteeredId: null };
const local = { controller: { id: 'local', execute: vi.fn() } };

function record(over = {}) {
  return {
    attemptId: 'a1', dispatchId: 'a1', targetId: 'office-tv', deviceId: 'office-tv', distance: 'far', kind: 'play',
    operation: 'play-now', item: { contentId: 'plex:266151', title: 'Hospital' }, title: 'Hospital',
    command: { play: 'plex:266151' }, phase: 'running', status: 'running', steps: [], createdAt: '2026-11-26T10:00:00.000Z', ...over,
  };
}

let ctx;
function mount(rec, { withTray = false } = {}) {
  ctx = {
    outcomes: new Map([[rec.attemptId, rec]]),
    retry: vi.fn(), removeDispatch: vi.fn(), stopAttempt: vi.fn(), recordLocal: vi.fn(), startOver: vi.fn(), sendElsewhere: vi.fn(), skipLocal: vi.fn(),
  };
  ctx.dispatches = ctx.outcomes;
  return render(
    <PeekContext.Provider value={peek}>
      <DispatchContext.Provider value={ctx}>
        <LocalSessionContext.Provider value={local}>
          {withTray && <DispatchProgressTray handleOwnsPlays />}
          <ScreenHandle />
        </LocalSessionContext.Provider>
      </DispatchContext.Provider>
    </PeekContext.Provider>,
    { wrapper: MantineProvider },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  nav.view = 'search'; nav.params = {};
  for (const k of Object.keys(entries)) delete entries[k];
});

describe('ScreenHandle follows a PLAY to a screen (addendum item 1)', () => {
  it('reads "▶ <title> · <screen>" and Starting on <screen> at once, with a spinner and Stop', () => {
    mount(record({ steps: [{ step: 'power', status: 'running' }] }));
    expect(screen.getByTestId('screen-handle-title')).toHaveTextContent('▶ Hospital · Office Screen');
    expect(screen.getByTestId('screen-handle-state')).toHaveTextContent('Starting on Office Screen… Turning on TV…');
    expect(screen.getByTestId('screen-handle')).toHaveAttribute('data-status', 'starting');
    expect(screen.getByTestId('screen-handle-spinner')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('screen-handle-stop'));
    expect(ctx.stopAttempt).toHaveBeenCalledWith('a1');
  });

  it('goes to Playing with pause / next / stop bound to that screen\'s session', () => {
    entries['office-tv'] = { snapshot: { state: 'playing', currentItem: { contentId: 'plex:266151', title: 'Hospital' }, queue: { items: [{}, {}], currentIndex: 0 } } };
    mount(record({ phase: 'confirmed', status: 'success', outcome: 'confirmed' }));
    expect(screen.getByTestId('screen-handle')).toHaveAttribute('data-status', 'playing');
    expect(screen.getByTestId('screen-handle-state')).toHaveTextContent('Playing');
    fireEvent.click(screen.getByTestId('screen-handle-toggle'));
    expect(transport.pause).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('screen-handle-next'));
    expect(transport.skipNext).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('screen-handle-stop'));
    expect(transport.stop).toHaveBeenCalledWith({ keepMusic: false });
  });

  it('opens that screen\'s remote from the title', () => {
    mount(record());
    fireEvent.click(screen.getByTestId('screen-handle-open'));
    expect(push).toHaveBeenCalledWith('peek', { deviceId: 'office-tv' });
  });

  it('the tray leaves the start the handle shows to the handle', () => {
    mount(record(), { withTray: true });
    expect(screen.queryByTestId('dispatch-row-a1')).toBeNull();
    expect(screen.getByTestId('screen-handle')).toBeInTheDocument();
  });
});

describe('ScreenHandle says why a start failed, with a way out (addendum item 3)', () => {
  it('"<screen> didn\'t start" with the reason, Retry and Play here', () => {
    mount(record({ phase: 'not-sent', status: 'failed', failedStep: 'power' }));
    expect(screen.getByTestId('screen-handle-state')).toHaveTextContent("Office Screen didn't start · The TV did not turn on");
    fireEvent.click(screen.getByTestId('screen-handle-retry'));
    expect(ctx.retry).toHaveBeenCalledWith('a1');
    fireEvent.click(screen.getByTestId('screen-handle-play-here'));
    expect(executeItemAction).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'playNow', item: expect.objectContaining({ contentId: 'plex:266151' }), destination: local.controller,
    }));
    expect(ctx.removeDispatch).toHaveBeenCalledWith('a1');
  });

  it('"<screen> is now playing <other>" when something else took the screen', () => {
    entries['office-tv'] = { snapshot: { state: 'playing', sessionId: 's2', currentItem: { contentId: 'plex:9', title: 'Bluey' } } };
    mount(record({ phase: 'confirmed', status: 'success', outcome: 'confirmed', outcomeIdentity: { sessionId: 's1' } }));
    expect(screen.getByTestId('screen-handle')).toHaveAttribute('data-status', 'preempted');
    expect(screen.getByTestId('screen-handle-state')).toHaveTextContent('Office Screen is now playing Bluey');
    expect(screen.getByTestId('screen-handle-retry')).toBeInTheDocument();
    expect(screen.getByTestId('screen-handle-play-here')).toBeInTheDocument();
  });
});
