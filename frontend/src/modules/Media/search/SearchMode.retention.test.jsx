// SearchMode retention integration: the real useContentCombobox reducer is
// essential here. A fixed-state hook mock cannot reveal selection's internal
// CLOSE transition, which is exactly what erased a retained search query after
// playback in the real phone journey.
import React, { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const RESULTS = [
  { id: 'plex:697368', title: 'Disclosure Day', type: 'movie', mediaType: 'video', thumbnail: null },
];
const streamSearch = vi.fn();
vi.mock('../../../hooks/useStreamingSearch', async (importOriginal) => ({
  ...(await importOriginal()),
  useStreamingSearch: () => ({
    results: RESULTS,
    pending: [],
    isSearching: false,
    sourceErrors: [],
    search: streamSearch,
  }),
}));

vi.mock('../cast/useDispatch.js', () => ({
  useDispatch: () => ({ dispatchToTarget: vi.fn(), dispatches: new Map(), retry: vi.fn() }),
}));
vi.mock('../fleet/useFleetContext.js', () => ({
  useFleetContext: () => ({ devices: [] }),
}));
vi.mock('../shell/useDismissLayer.js', () => ({ useDismissLayer: () => {} }));
vi.mock('../cast/DispatchTargetPicker.jsx', () => ({
  DispatchTargetPicker: () => <div data-testid="picker-stub" />,
}));
vi.mock('@mantine/notifications', () => ({ notifications: { show: vi.fn() } }));
vi.mock('../logging/mediaLog.js', () => {
  const stub = new Proxy({}, { get: (target, key) => (target[key] ??= vi.fn()) });
  return { default: stub };
});
vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) }),
}));
vi.mock('../../../lib/logging/singleton.js', () => ({
  getChildLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(async (path) => (
    path === 'api/v1/media/config'
      ? { searchScopes: [
          { key: 'all', label: 'All', params: '' },
          { key: 'video', label: 'Video', params: 'mediaType=video' },
        ] }
      : {}
  )),
}));

import { createLocalSessionController } from '../session/LocalSessionController.js';
import { LocalSessionContext } from '../session/LocalSessionContext.js';
import { CastTargetProvider } from '../cast/CastTargetProvider.jsx';
import { NavProvider } from '../shell/NavProvider.jsx';
import { SearchProvider } from './SearchProvider.jsx';
import { SearchMode } from './SearchMode.jsx';

let controller;

function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <MantineProvider>
      <NavProvider>
        <LocalSessionContext.Provider value={{ controller }}>
          <CastTargetProvider>
            <SearchProvider>
              {open && <SearchMode onClose={() => setOpen(false)} />}
            </SearchProvider>
          </CastTargetProvider>
        </LocalSessionContext.Provider>
      </NavProvider>
    </MantineProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('EventSource', class EventSource {});
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  controller = createLocalSessionController({
    clientId: 'search-retention-test',
    randomUuid: () => 'session-retention',
  });
});

describe('SearchMode real combobox retention', () => {
  it('keeps the typed query and selected scope after leaf Play reaches the real controller', async () => {
    render(<Harness />);
    const input = await screen.findByTestId('search-mode-input');
    fireEvent.change(input, { target: { value: 'Disclosure Day' } });
    fireEvent.click(await screen.findByTestId('scope-chip-video'));
    fireEvent.click(await screen.findByTestId('search-mode-result-plex:697368'));

    expect(controller.getSnapshot()).toMatchObject({
      state: 'loading',
      currentItem: { contentId: 'plex:697368', title: 'Disclosure Day' },
    });
    expect(screen.getByTestId('search-mode')).toBeInTheDocument();
    expect(screen.getByTestId('search-mode-input')).toHaveValue('Disclosure Day');
    expect(screen.getByTestId('scope-chip-video')).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(streamSearch).toHaveBeenCalledWith('Disclosure Day'));
  });
});
