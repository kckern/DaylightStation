// @vitest-environment jsdom
// Escape on an open row menu closes the menu and nothing else. Without a
// registered dismiss layer for that menu the shell's base action ("Back")
// ran after the menu closed, so the page left under the user (PLACE.3a).
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { BrowseView } from './BrowseView.jsx';
import { NavProvider } from '../shell/NavProvider.jsx';
import { CastTargetProvider } from '../cast/CastTargetProvider.jsx';
import { DismissStackProvider } from '../shell/DismissStackProvider.jsx';
import { DaylightAPI } from '../../../lib/api.mjs';

vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));
vi.mock('../search/useContentDispatch.js', () => ({
  useContentDispatch: () => ({ dispatchLeafVerb: vi.fn(), playContainerAsQueue: vi.fn(), addContainerToQueue: vi.fn() }),
}));
vi.mock('../fleet/useFleetContext.js', () => ({ useFleetContext: () => ({ devices: [] }) }));
vi.mock('../cast/DispatchTargetPicker.jsx', () => ({ DispatchTargetPicker: () => null }));

beforeEach(() => {
  vi.stubGlobal('matchMedia', query => Object.assign(new EventTarget(), {
    matches: false, media: query, addListener() {}, removeListener() {},
  }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  localStorage.clear();
  window.history.replaceState({ mediaNavStack: [{ view: 'browse', params: { path: 'plex/season-2', label: 'Season 2' } }] },
    '', '/media?view=browse&path=plex%2Fseason-2');
  DaylightAPI.mockResolvedValue({ items: [
    { id: 'plex:e1', title: 'Episode 1', type: 'episode', itemType: 'item', index: 1 },
  ], total: 1 });
});
afterEach(() => vi.unstubAllGlobals());

describe('Browse row menu and Escape', () => {
  it('closes the menu without also running the shell Back action', async () => {
    const base = vi.fn();
    render(
      <MantineProvider>
        <NavProvider>
          <CastTargetProvider>
            <DismissStackProvider onBaseDismiss={base}>
              <BrowseView path="plex/season-2" label="Season 2" />
            </DismissStackProvider>
          </CastTargetProvider>
        </NavProvider>
      </MantineProvider>,
    );
    const more = await screen.findByTestId('result-more-plex:e1');
    await act(async () => { fireEvent.click(more); });
    expect(await screen.findByRole('menuitem', { name: 'Play on…' })).toBeTruthy();
    await act(async () => { fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' }); });
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'Play on…' })).toBeNull());
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(base).not.toHaveBeenCalled();
  });
});
