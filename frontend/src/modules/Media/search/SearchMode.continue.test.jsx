// FIND.8b/AC2 — a collection result's inline play reads "Play", or
// "Continue S2E7" when the household has one under way, and plays that part.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const dispatchLeafVerbMock = vi.fn();
const playContainerAsQueueMock = vi.fn();
vi.mock('./useContentDispatch.js', () => ({
  useContentDispatch: () => ({ dispatch: vi.fn(), dispatchLeafVerb: dispatchLeafVerbMock, playContainerAsQueue: playContainerAsQueueMock, addToScreen: vi.fn() }),
}));
vi.mock('../controller/useSessionController.js', () => ({
  useSessionController: () => ({ queue: { playNow: vi.fn(), playNext: vi.fn(), addUpNext: vi.fn(), add: vi.fn() } }),
}));
vi.mock('../shell/NavProvider.jsx', () => ({ useNav: () => ({ push: vi.fn() }) }));
let results = [];
vi.mock('../../Content/combobox/useContentCombobox.js', () => ({
  useContentCombobox: () => ({
    state: { search: 'bluey', results }, handleInput: vi.fn(), select: vi.fn(),
    isSearching: false, pendingSources: [], sourceErrors: [], fellBackToAll: false,
  }),
}));
vi.mock('../logging/mediaLog.js', () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});
vi.mock('../fleet/useFleetContext.js', () => ({ useFleetContext: () => ({ devices: [] }) }));
vi.mock('../shell/useDismissLayer.js', () => ({ useDismissLayer: () => {} }));
vi.mock('../cast/DispatchTargetPicker.jsx', () => ({ DispatchTargetPicker: () => null }));
vi.mock('../../../lib/logging/Logger.js', () => ({ default: () => ({ child: () => ({ info: vi.fn() }) }) }));
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: vi.fn(async () => ({})) }));
let carryOnItems = [];
vi.mock('../../../lib/hooks/useApiResource.js', () => ({
  useApiResource: () => ({ data: { items: carryOnItems }, error: null, reload: vi.fn() }),
  invalidateApiResources: vi.fn(),
}));

import { SearchProvider } from './SearchProvider.jsx';
import { CastTargetProvider } from '../cast/CastTargetProvider.jsx';
import { SearchMode } from './SearchMode.jsx';

const show = { id: 'plex:100', title: 'Bluey', type: 'show', itemType: 'container', childCount: 155 };

function mount() {
  return render(
    <MantineProvider><CastTargetProvider><SearchProvider><SearchMode onClose={() => {}} /></SearchProvider></CastTargetProvider></MantineProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  results = [show];
  carryOnItems = [];
  localStorage.clear();
});

describe('SearchMode collection inline play (FIND.8b/AC2)', () => {
  it('reads Play, and plays the whole collection, when nothing is under way', () => {
    mount();
    const button = screen.getByTestId('result-play-all-plex:100');
    expect(button).toHaveTextContent('Play');
    fireEvent.click(button);
    expect(playContainerAsQueueMock).toHaveBeenCalledTimes(1);
    expect(dispatchLeafVerbMock).not.toHaveBeenCalled();
  });

  it('reads Continue S2E7 when a part is under way, and plays that episode', () => {
    carryOnItems = [{ contentId: 'plex:507', title: 'Bingo', type: 'episode', parentId: '20', grandparentId: '100', parentTitle: 'Season 2', itemIndex: 7 }];
    mount();
    const button = screen.getByTestId('result-play-all-plex:100');
    expect(button).toHaveTextContent('Continue S2E7');
    fireEvent.click(button);
    expect(dispatchLeafVerbMock).toHaveBeenCalledWith('playNow', 'plex:507', expect.objectContaining({ title: 'Bingo' }));
    expect(playContainerAsQueueMock).not.toHaveBeenCalled();
  });
});
