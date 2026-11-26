// Addendum items 5–7 (2026-11-26) as a search row's labels.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
vi.mock("../../../../../frontend/src/lib/api.mjs", () => ({ DaylightAPI: vi.fn(async () => ({ items: [] })) }));
vi.mock("../logging/mediaLog.js", () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});
import { useRowLabels } from "./useRowLabels.js";
import { FleetContext } from "../fleet/FleetProvider.jsx";
import { DispatchContext } from "../cast/DispatchProvider.jsx";
import { CastTargetContext } from "../cast/CastTargetProvider.jsx";
import { resetApiResourceCache } from "../../../../../frontend/src/lib/hooks/useApiResource.js";

const entries = {};
const fleet = {
  devices: [{ id: 'office-tv', name: 'Office Screen', content_control: { type: 'websocket' } }], identity: { deviceId: 'browser:me' },
  store: { getEntry: (id) => entries[id] ?? null, subscribeAll: () => () => {} },
};
const item = { id: 'plex:1', title: 'Hospital', type: 'episode', itemType: 'leaf', mediaType: 'video' };
function labels(outcomes = new Map()) {
  const wrapper = ({ children }) => (
    <FleetContext.Provider value={fleet}>
      <CastTargetContext.Provider value={{ targetIds: ['office-tv'], mode: 'fork' }}>
        <DispatchContext.Provider value={{ outcomes }}>{children}</DispatchContext.Provider>
      </CastTargetContext.Provider>
    </FleetContext.Provider>
  );
  return renderHook(() => useRowLabels(), { wrapper }).result.current.rowLabelsFor(item);
}

beforeEach(() => { resetApiResourceCache(); for (const k of Object.keys(entries)) delete entries[k]; });

describe('useRowLabels', () => {
  it('a row on a screen says "On <screen>" and its button pauses there (item 5)', () => {
    entries['office-tv'] = { snapshot: { state: 'playing', currentItem: { contentId: 'plex:1' } } };
    const row = labels();
    expect(row.subtitle).toBe('On Office Screen');
    expect(row.playingOn).toMatchObject({ text: 'Pause', toggleLabel: 'Pause Hospital on Office Screen' });
    expect(row.menu.find((e) => e.kind === 'openScreen')?.label).toBe('Open Office Screen');
  });
  it('its ▶ spins only while its own start is in flight (item 6)', () => {
    const outcomes = new Map([['a', { attemptId: 'a', targetId: 'office-tv', distance: 'far', kind: 'play', phase: 'running', status: 'running', item: { contentId: 'plex:1' } }]]);
    expect(labels(outcomes).playBusy).toBe(true);
    expect(labels().playBusy).toBe(false);
  });
  it('the ⋯ entries come from the one table, aimed at the screen (item 7)', () => {
    const names = labels().menu.filter((e) => !e.divider).map((e) => e.label);
    expect(names).toEqual(expect.arrayContaining(['Play on Office Screen', 'Play here', 'Play Next on Office Screen', 'Open detail', 'Add to favourites']));
  });
});
