import React, { useLayoutEffect } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { CastTargetProvider, CAST_TARGET_KEY } from './CastTargetProvider.jsx';
import { useCastTarget } from './useCastTarget.js';
import { FleetContext } from '../fleet/FleetProvider.jsx';
import { ClientIdentityContext } from '../identity/ClientIdentityProvider.jsx';
import { PeekContext } from '../peek/PeekContext.js';

vi.mock('../logging/mediaLog.js', () => {
  const stub = new Proxy({}, { get: (target, key) => (target[key] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

function Probe() {
  const { mode, targetIds, setMode, toggleTarget, clearTargets } = useCastTarget();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="targets">{targetIds.join(',')}</span>
      <button data-testid="set-fork" onClick={() => setMode('fork')}>fork</button>
      <button data-testid="toggle-lr" onClick={() => toggleTarget('lr')}>lr</button>
      <button data-testid="toggle-ot" onClick={() => toggleTarget('ot')}>ot</button>
      <button data-testid="clear" onClick={clearTargets}>clear</button>
    </div>
  );
}

function InitialProbe({ onInitial }) {
  const { mode, targetIds } = useCastTarget();
  useLayoutEffect(() => onInitial({ mode, targetIds }), [mode, targetIds, onInitial]);
  return null;
}

describe('CastTargetProvider', () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('defaults to mode=transfer with empty targets', () => {
    render(<CastTargetProvider><Probe /></CastTargetProvider>);
    expect(screen.getByTestId('mode')).toHaveTextContent('transfer');
    expect(screen.getByTestId('targets')).toHaveTextContent('');
  });

  it('toggleTarget adds and removes ids; multi-select is ad-hoc', () => {
    render(<CastTargetProvider><Probe /></CastTargetProvider>);
    act(() => { screen.getByTestId('toggle-lr').click(); });
    act(() => { screen.getByTestId('toggle-ot').click(); });
    expect(screen.getByTestId('targets')).toHaveTextContent('lr,ot');
    act(() => { screen.getByTestId('toggle-lr').click(); });
    expect(screen.getByTestId('targets')).toHaveTextContent('ot');
  });

  it('setMode switches transfer ↔ fork; invalid ignored', () => {
    render(<CastTargetProvider><Probe /></CastTargetProvider>);
    act(() => { screen.getByTestId('set-fork').click(); });
    expect(screen.getByTestId('mode')).toHaveTextContent('fork');
  });

  it('persists mode + targets and restores on mount', () => {
    const { unmount } = render(<CastTargetProvider><Probe /></CastTargetProvider>);
    act(() => { screen.getByTestId('toggle-lr').click(); });
    act(() => { screen.getByTestId('set-fork').click(); });
    expect(localStorage.getItem(CAST_TARGET_KEY)).toContain('fork');
    unmount();

    render(<CastTargetProvider><Probe /></CastTargetProvider>);
    expect(screen.getByTestId('mode')).toHaveTextContent('fork');
    expect(screen.getByTestId('targets')).toHaveTextContent('lr');
  });

  it('clearTargets empties the array', () => {
    render(<CastTargetProvider><Probe /></CastTargetProvider>);
    act(() => { screen.getByTestId('toggle-lr').click(); });
    act(() => { screen.getByTestId('clear').click(); });
    expect(screen.getByTestId('targets')).toHaveTextContent('');
  });

  it('shows This device on its first layout pass when the restored aim is expired', () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    localStorage.setItem(CAST_TARGET_KEY, JSON.stringify({
      mode: 'fork', targetIds: ['office'], activityAt: now - (2 * 60 * 60 * 1000),
    }));
    const onInitial = vi.fn();

    render(<CastTargetProvider><InitialProbe onInitial={onInitial} /></CastTargetProvider>);

    expect(onInitial.mock.calls[0]).toEqual([{ mode: 'fork', targetIds: [] }]);
  });

  it('renews the persisted idle lease from a real pointer interaction', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_100_000);
    localStorage.setItem(CAST_TARGET_KEY, JSON.stringify({
      mode: 'fork', targetIds: ['office'], activityAt: 1_700_000_000_000,
    }));
    render(<CastTargetProvider><Probe /></CastTargetProvider>);

    fireEvent.pointerDown(document.body);

    expect(JSON.parse(localStorage.getItem(CAST_TARGET_KEY))).toMatchObject({
      targetIds: ['office'], activityAt: 1_700_000_100_000,
    });
  });

  it('returns to This device on reload after a known two-hour idle observation', () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    localStorage.setItem(CAST_TARGET_KEY, JSON.stringify({
      mode: 'fork', targetIds: ['office'], activityAt: now - (2 * 60 * 60 * 1000),
    }));
    const fleet = { store: { getEntry: () => ({ snapshot: { state: 'idle' } }), subscribeAll: () => () => {} } };

    render(
      <ClientIdentityContext.Provider value={{ clientId: 'phone' }}>
        <FleetContext.Provider value={fleet}>
          <PeekContext.Provider value={{ getSteeringActivity: () => null }}>
            <CastTargetProvider><Probe /></CastTargetProvider>
          </PeekContext.Provider>
        </FleetContext.Provider>
      </ClientIdentityContext.Provider>
    );

    expect(screen.getByTestId('targets')).toBeEmptyDOMElement();
    expect(JSON.parse(localStorage.getItem(CAST_TARGET_KEY))).toMatchObject({ targetIds: [] });
  });

  it('retains an otherwise-expired aim on first layout when matching sent playback is active', () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    localStorage.setItem(CAST_TARGET_KEY, JSON.stringify({
      mode: 'fork', targetIds: ['office'], activityAt: now - (2 * 60 * 60 * 1000) - 1,
    }));
    const sent = {
      ownerId: 'office',
      playback: {
        sessionId: 'sent-session', contentId: 'plex:arrival',
        queueItemId: 'arrival-visit', ownerInstanceId: 'owner-office', playbackRevision: 7,
      },
    };
    const fleet = { store: {
      getEntry: () => ({
        snapshot: {
          sessionId: 'sent-session', state: 'playing',
          currentItem: { contentId: 'plex:arrival', queueItemId: 'arrival-visit' },
          meta: {
            ownerId: 'office',
            playbackOwner: { ownerInstanceId: 'owner-office', playbackRevision: 7 },
          },
        },
      }),
      subscribeAll: () => () => {},
    } };
    const onInitial = vi.fn();

    render(
      <ClientIdentityContext.Provider value={{ clientId: 'phone' }}>
        <FleetContext.Provider value={fleet}>
          <PeekContext.Provider value={{ getSteeringActivity: () => sent }}>
            <CastTargetProvider><InitialProbe onInitial={onInitial} /></CastTargetProvider>
          </PeekContext.Provider>
        </FleetContext.Provider>
      </ClientIdentityContext.Provider>
    );

    expect(onInitial.mock.calls[0]).toEqual([{ mode: 'fork', targetIds: ['office'] }]);
    expect(JSON.parse(localStorage.getItem(CAST_TARGET_KEY))).toMatchObject({
      targetIds: ['office'], exemptionStartedAt: now,
    });
  });

  it('ends a steering exemption when a fresh fleet update names newer playback', () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    localStorage.setItem(CAST_TARGET_KEY, JSON.stringify({
      mode: 'fork', targetIds: ['office'], activityAt: now - (60 * 60 * 1000),
    }));
    const steering = { ownerId: 'office', playback: { sessionId: 's-1', contentId: 'plex:1', queueItemId: 'q-1', ownerInstanceId: 'owner-1', playbackRevision: 2 } };
    const activeFleet = { store: { getEntry: () => ({
      snapshot: { sessionId: 's-1', state: 'playing', currentItem: { contentId: 'plex:1', queueItemId: 'q-1' }, meta: { ownerId: 'office', playbackOwner: { ownerInstanceId: 'owner-1', playbackRevision: 2 } } },
    }), subscribeAll: () => () => {} } };
    const newerFleet = { store: { getEntry: () => ({
      snapshot: { sessionId: 's-1', state: 'playing', currentItem: { contentId: 'plex:1', queueItemId: 'q-1' }, meta: { ownerId: 'other', playbackOwner: { ownerInstanceId: 'owner-1', playbackRevision: 2 } } },
    }), subscribeAll: () => () => {} } };
    const renderTree = (fleet) => (
      <ClientIdentityContext.Provider value={{ clientId: 'phone' }}>
        <FleetContext.Provider value={fleet}>
          <PeekContext.Provider value={{ getSteeringActivity: () => steering }}>
            <CastTargetProvider><Probe /></CastTargetProvider>
          </PeekContext.Provider>
        </FleetContext.Provider>
      </ClientIdentityContext.Provider>
    );

    const view = render(renderTree(activeFleet));
    expect(screen.getByTestId('targets')).toHaveTextContent('office');
    view.rerender(renderTree(newerFleet));
    expect(screen.getByTestId('targets')).toHaveTextContent('office');
    expect(JSON.parse(localStorage.getItem(CAST_TARGET_KEY))).toMatchObject({ exemptionStartedAt: null });
  });
});
