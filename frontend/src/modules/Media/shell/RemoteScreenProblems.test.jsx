// RELY.5a/AC4 — a failure or skip a steered screen reports on its own reaches the sender.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';

vi.mock('../logging/mediaLog.js', () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

import { FleetContext } from '../fleet/FleetProvider.jsx';
import { DispatchContext } from '../cast/DispatchProvider.jsx';
import { PeekContext } from '../peek/PeekContext.js';
import { CastTargetContext } from '../cast/CastTargetProvider.jsx';
import { RemoteScreenProblems, freshRemoteProblems, REMOTE_PROBLEM_FRESH_MS } from './RemoteScreenProblems.jsx';

const problem = (over = {}) => ({ kind: 'skipped', reason: 'stalled', item: { contentId: 'plex:1', title: 'Arrival' }, replacement: { contentId: 'plex:2', title: 'Disclosure Day' }, at: Date.now(), ...over });

describe('freshRemoteProblems', () => {
  it('reports a watched screen\'s new problem once, ignoring unwatched screens and stale ones', () => {
    const now = 1_000_000;
    const entries = {
      tv: { snapshot: { meta: { problem: problem({ at: now - 1000 }) } } },
      other: { snapshot: { meta: { problem: problem({ at: now - 1000 }) } } },
      old: { snapshot: { meta: { problem: problem({ at: now - REMOTE_PROBLEM_FRESH_MS - 1 }) } } },
    };
    const seen = new Set();
    const args = { watchedIds: new Set(['tv', 'old']), entryFor: (id) => entries[id], seen, now };
    expect(freshRemoteProblems(args).map((p) => p.deviceId)).toEqual(['tv']);
    expect(freshRemoteProblems(args)).toEqual([]);
  });
});

describe('RemoteScreenProblems', () => {
  let listeners; let entries; const recordLocal = vi.fn(() => 'row-1'); const removeDispatch = vi.fn();
  const store = { getEntry: (id) => entries[id] ?? null, subscribeAll: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } };
  const fire = () => act(() => { for (const fn of [...listeners]) fn(); });
  const mount = ({ aimIds = [], steered = 'tv', sentTo = [] } = {}) => render(
    <FleetContext.Provider value={{ store, devices: [{ id: 'tv', name: 'Living Room TV' }] }}>
      <DispatchContext.Provider value={{ recordLocal, removeDispatch, outcomes: new Map(sentTo.map((id) => [`o-${id}`, { targetId: id }])) }}>
        <PeekContext.Provider value={{ lastSteeredId: steered }}>
          <CastTargetContext.Provider value={{ targetIds: aimIds }}>
            <RemoteScreenProblems />
          </CastTargetContext.Provider>
        </PeekContext.Provider>
      </DispatchContext.Provider>
    </FleetContext.Provider>
  );
  beforeEach(() => { listeners = new Set(); entries = {}; recordLocal.mockClear(); removeDispatch.mockClear(); });

  it('records a skip on the steered screen as an outcome naming the item, screen and replacement', () => {
    mount();
    expect(recordLocal).not.toHaveBeenCalled();
    entries.tv = { snapshot: { meta: { problem: problem() } } };
    fire();
    expect(recordLocal).toHaveBeenCalledTimes(1);
    expect(recordLocal).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'playback', phase: 'skipped', targetId: 'tv', targetName: 'Living Room TV',
      item: { contentId: 'plex:1', title: 'Arrival' }, replacement: { contentId: 'plex:2', title: 'Disclosure Day' },
    }));
    fire();
    expect(recordLocal).toHaveBeenCalledTimes(1);
  });

  it('records a failure with nothing to play instead as failed', () => {
    mount();
    entries.tv = { snapshot: { meta: { problem: problem({ kind: 'failed', replacement: null }) } } };
    fire();
    expect(recordLocal).toHaveBeenCalledWith(expect.objectContaining({ phase: 'failed', replacement: null }));
  });

  it('says nothing about a screen that is merely aimed at (not sent to or steered)', () => {
    mount({ aimIds: ['tv'], steered: null });
    entries.tv = { snapshot: { meta: { problem: problem() } } };
    fire();
    expect(recordLocal).not.toHaveBeenCalled();
  });

  it('reports a screen this device sent something to', () => {
    mount({ steered: null, sentTo: ['tv'] });
    entries.tv = { snapshot: { meta: { problem: problem() } } };
    fire();
    expect(recordLocal).toHaveBeenCalledTimes(1);
  });

  it('says nothing about a screen this device neither sent to nor steers', () => {
    mount({ steered: null });
    entries.tv = { snapshot: { meta: { problem: problem() } } };
    fire();
    expect(recordLocal).not.toHaveBeenCalled();
  });

  it('labels a held screen as waiting, not failed, and withdraws the row when the screen resumes', () => {
    mount();
    const held = problem({ kind: 'waiting', reason: 'source-unavailable-gave-up', replacement: null });
    entries.tv = { snapshot: { meta: { problem: held } } };
    fire();
    expect(recordLocal).toHaveBeenCalledWith(expect.objectContaining({ phase: 'waiting', targetId: 'tv' }));
    expect(removeDispatch).not.toHaveBeenCalled();
    entries.tv = { snapshot: { meta: {} } };
    fire();
    expect(removeDispatch).toHaveBeenCalledWith('row-1');
    fire();
    expect(removeDispatch).toHaveBeenCalledTimes(1);
  });
});
