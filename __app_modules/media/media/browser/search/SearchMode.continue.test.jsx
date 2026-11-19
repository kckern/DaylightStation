// FIND.8b/AC2 — a collection result's inline play reads "Play", or
// "Continue S2E7" when the household has one under way, and plays that part.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { DaylightAPI } from "../../../../../frontend/src/lib/api.mjs";
import { resetApiResourceCache } from "../../../../../frontend/src/lib/hooks/useApiResource.js";

const dispatchLeafVerbMock = vi.fn();
const playContainerAsQueueMock = vi.fn();
vi.mock("./useContentDispatch.js", () => ({
  useContentDispatch: () => ({ dispatch: vi.fn(), dispatchLeafVerb: dispatchLeafVerbMock, playContainerAsQueue: playContainerAsQueueMock, addToScreen: vi.fn() }),
}));
vi.mock("../controller/useSessionController.js", () => ({
  useSessionController: () => ({ queue: { playNow: vi.fn(), playNext: vi.fn(), addUpNext: vi.fn(), add: vi.fn() } }),
}));
vi.mock("../shell/NavProvider.jsx", () => ({ useNav: () => ({ push: vi.fn() }) }));
let results = [];
vi.mock("../../../../../__capabilities/content-catalog/browser/picker-controller.mjs", () => ({
  useContentCombobox: () => ({
    state: { search: 'bluey', results }, handleInput: vi.fn(), select: vi.fn(),
    isSearching: false, pendingSources: [], sourceErrors: [], fellBackToAll: false,
  }),
}));
vi.mock("../logging/mediaLog.js", () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});
vi.mock("../fleet/useFleetContext.js", () => ({ useFleetContext: () => ({ devices: [] }) }));
vi.mock("@/lib/ui/dismiss/useDismissLayer.js", () => ({ useDismissLayer: () => {} }));
vi.mock("../cast/DispatchTargetPicker.jsx", () => ({ DispatchTargetPicker: () => null }));
vi.mock("../../../../../frontend/src/lib/logging/Logger.js", () => {
  const getLogger = () => ({ child: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }) });
  return { default: getLogger, getLogger };
});
vi.mock("../../../../../frontend/src/lib/api.mjs", () => ({ DaylightAPI: vi.fn() }));

import { SearchProvider } from "./SearchProvider.jsx";
import { CastTargetProvider } from "../cast/CastTargetProvider.jsx";
import { SearchMode } from "./SearchMode.jsx";

const show = { id: 'plex:100', title: 'Bluey', type: 'show', itemType: 'container', childCount: 155 };

const carryOnPath = 'api/v1/media/household/carry-on?limit=12';
const configPath = 'api/v1/media/config';
const favouritesPath = 'api/v1/media/household/favourites';

async function mount(items) {
  DaylightAPI.mockImplementation(async path => {
    if (path === configPath) return { searchScopes: [] };
    if (path === favouritesPath) return { items: [] };
    if (path === carryOnPath) return { items };
    throw new Error(`Unexpected API request: ${path}`);
  });

  await act(async () => {
    render(
      <MantineProvider><CastTargetProvider><SearchProvider><SearchMode onClose={() => {}} /></SearchProvider></CastTargetProvider></MantineProvider>
    );
  });
  expect(DaylightAPI.mock.calls.filter(([path]) => path !== configPath && path !== favouritesPath)).toEqual([[carryOnPath]]);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetApiResourceCache();
  results = [show];
  localStorage.clear();
});

describe('SearchMode collection inline play (FIND.8b/AC2)', () => {
  it('reads Play, and plays the whole collection, when nothing is under way', async () => {
    await mount([]);
    fireEvent.click(await screen.findByRole('button', { name: 'Play', exact: true }));
    expect(playContainerAsQueueMock).toHaveBeenCalledExactlyOnceWith('plex:100', show);
    expect(dispatchLeafVerbMock).not.toHaveBeenCalled();
  });

  it('reads Continue S2E7 when a part is under way, and plays that episode', async () => {
    await mount([{ contentId: 'plex:507', title: 'Bingo', type: 'episode', parentId: '20', grandparentId: '100', parentTitle: 'Season 2', itemIndex: 7 }]);
    fireEvent.click(await screen.findByRole('button', { name: 'Continue S2E7', exact: true }));
    expect(dispatchLeafVerbMock).toHaveBeenCalledExactlyOnceWith('playNow', 'plex:507', expect.objectContaining({ title: 'Bingo' }));
    expect(playContainerAsQueueMock).not.toHaveBeenCalled();
  });
});
