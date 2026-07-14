// frontend/src/modules/Media/fleet/FleetPlayPicker.test.jsx
// The inline play-on-this-device picker: search wiring, row-tap dispatching
// (fork, correct device, human title), busy heads-up, dismissal, and the
// no-raw-ids copy rule.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mutable holders — the mock factories close over these but only read them
// at render/call time (same pattern as useDevices.test.jsx).
const search = { value: null };
const dispatchToTarget = vi.fn();
const fleet = { device: null, entry: null };

vi.mock('../search/useLiveSearch.js', () => ({
  useLiveSearch: () => search.value,
}));
vi.mock('../cast/useDispatch.js', () => ({
  useDispatch: () => ({ dispatchToTarget }),
}));
vi.mock('./useDevice.js', () => ({
  useDevice: () => ({ device: fleet.device, entry: fleet.entry }),
}));

import { FleetPlayPicker } from './FleetPlayPicker.jsx';

function baseSearch(overrides = {}) {
  return {
    results: [],
    pending: [],
    isSearching: false,
    error: null,
    sourceErrors: [],
    setQuery: vi.fn(),
    retry: vi.fn(),
    ...overrides,
  };
}

const BLUEY = { id: 'plex:12345', title: 'Bluey (2018)', type: 'show', childCount: 155 };

beforeEach(() => {
  dispatchToTarget.mockReset();
  search.value = baseSearch();
  fleet.device = { id: 'livingroom-tv', name: 'Living Room TV', type: 'shield-tv' };
  fleet.entry = null;
});

function renderPicker(props = {}) {
  const onClose = vi.fn();
  const utils = render(
    <FleetPlayPicker deviceId="livingroom-tv" onClose={onClose} {...props} />,
  );
  return { onClose, ...utils };
}

function typeQuery(text) {
  fireEvent.change(screen.getByTestId('fleet-play-input-livingroom-tv'), {
    target: { value: text },
  });
}

describe('FleetPlayPicker', () => {
  it('renders an autofocused search input with a friendly device-name placeholder', () => {
    renderPicker();
    const input = screen.getByTestId('fleet-play-input-livingroom-tv');
    expect(input).toHaveAttribute('placeholder', 'Play on Living Room TV…');
    expect(document.activeElement).toBe(input);
  });

  it('feeds keystrokes into the live search', () => {
    renderPicker();
    typeQuery('bluey');
    expect(search.value.setQuery).toHaveBeenCalledWith('bluey');
  });

  it('shows a searching indicator while the search is in flight with no results yet', () => {
    search.value = baseSearch({ isSearching: true });
    renderPicker();
    typeQuery('bluey');
    expect(screen.getByTestId('fleet-play-searching')).toHaveTextContent('Searching…');
  });

  it('tapping a result dispatches fork to THIS device with the human title, then closes', () => {
    search.value = baseSearch({ results: [BLUEY] });
    const { onClose } = renderPicker();
    typeQuery('bluey');
    fireEvent.click(screen.getByTestId('fleet-play-result-plex:12345'));
    expect(dispatchToTarget).toHaveBeenCalledWith({
      targetIds: ['livingroom-tv'],
      play: 'plex:12345',
      title: 'Bluey (2018)',
      mode: 'fork',
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('result rows show title + human context, never the raw source id', () => {
    search.value = baseSearch({ results: [BLUEY] });
    renderPicker();
    typeQuery('bluey');
    const panel = screen.getByTestId('fleet-play-panel-livingroom-tv');
    expect(panel.textContent).toContain('Bluey (2018)');
    expect(panel.textContent).toContain('TV Show · 155 episodes');
    expect(panel.textContent).not.toContain('plex:12345');
    expect(panel.textContent).not.toMatch(/\bplex\b/);
  });

  it('shows a Still searching row under results while sources are pending', () => {
    search.value = baseSearch({ results: [BLUEY], pending: ['abs'], isSearching: true });
    renderPicker();
    typeQuery('bluey');
    expect(screen.getByTestId('fleet-play-pending')).toHaveTextContent('Still searching…');
  });

  it('warns in one quiet line when the device is playing something', () => {
    fleet.entry = { snapshot: { state: 'playing', currentItem: { title: 'Frozen II' } } };
    renderPicker();
    expect(screen.getByTestId('fleet-play-busy-livingroom-tv'))
      .toHaveTextContent('Playing Frozen II — this will replace it');
  });

  it('also warns for paused content, and not at all when idle or unreported', () => {
    fleet.entry = { snapshot: { state: 'paused', currentItem: { title: 'Frozen II' } } };
    const { unmount } = renderPicker();
    expect(screen.getByTestId('fleet-play-busy-livingroom-tv'))
      .toHaveTextContent('Paused on Frozen II — this will replace it');
    unmount();

    fleet.entry = { snapshot: { state: 'idle', currentItem: null } };
    const second = renderPicker();
    expect(screen.queryByTestId('fleet-play-busy-livingroom-tv')).toBeNull();
    second.unmount();

    fleet.entry = null; // never reported — unknown must not cry wolf
    renderPicker();
    expect(screen.queryByTestId('fleet-play-busy-livingroom-tv')).toBeNull();
  });

  it('shows the friendly empty state (no raw errors) when a search finds nothing', () => {
    search.value = baseSearch();
    renderPicker();
    typeQuery('zzzz');
    expect(screen.getByTestId('search-empty'))
      .toHaveTextContent('No results for “zzzz”');
  });

  it('offers retry with friendly copy when the search errors', () => {
    search.value = baseSearch({ error: { kind: 'connection', message: 'abs timeout after 8000ms' } });
    renderPicker();
    typeQuery('bluey');
    const errorState = screen.getByTestId('search-error');
    expect(errorState).toHaveTextContent('Lost connection to the search service.');
    expect(errorState.textContent).not.toContain('8000ms');
    fireEvent.click(screen.getByTestId('search-retry'));
    expect(search.value.retry).toHaveBeenCalled();
  });

  it('dismisses on Escape', () => {
    const { onClose } = renderPicker();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('dismisses on pointerdown outside the panel', () => {
    const { onClose } = renderPicker();
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it('does NOT dismiss on pointerdown inside the panel', () => {
    const { onClose } = renderPicker();
    fireEvent.pointerDown(screen.getByTestId('fleet-play-input-livingroom-tv'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
