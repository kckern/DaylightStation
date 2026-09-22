// Phone SearchMode with the real Content combobox transport lifecycle.
import React, { useState } from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

vi.mock('../cast/useDispatch.js', () => ({ useDispatch: () => ({ dispatchToTarget: vi.fn(), dispatches: new Map(), retry: vi.fn() }) }));
vi.mock('../fleet/useFleetContext.js', () => ({ useFleetContext: () => ({ devices: [] }) }));
vi.mock('../shell/useDismissLayer.js', () => ({ useDismissLayer: () => {} }));
vi.mock('../cast/DispatchTargetPicker.jsx', () => ({ DispatchTargetPicker: () => <div data-testid="picker-stub" /> }));
vi.mock('@mantine/notifications', () => ({ notifications: { show: vi.fn() } }));
vi.mock('../logging/mediaLog.js', () => {
  const logger = new Proxy({}, { get: (target, key) => (target[key] ??= vi.fn()) });
  return { default: logger };
});
vi.mock('../../../lib/logging/Logger.js', () => ({ default: () => ({ child: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) }) }));
vi.mock('../../../lib/logging/singleton.js', () => ({ getChildLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(async (path) => (path === 'api/v1/media/config'
    ? { searchScopes: [
      { key: 'all', label: 'All', params: 'capability=listable&scope=kids' },
      { key: 'family', label: 'Family', params: 'capability=listable&scope=family' },
    ] }
    : {})),
}));

class MockEventSource {
  constructor(url) { this.url = url; this.readyState = 0; MockEventSource.instances.push(this); }
  close() { this.readyState = 2; }
  simulateMessage(data) { this.onmessage?.({ data: JSON.stringify(data) }); }
  simulateError() { this.onerror?.(new Error('connection failed')); }
}
MockEventSource.instances = [];

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
    <MantineProvider><NavProvider><LocalSessionContext.Provider value={{ controller }}><CastTargetProvider><SearchProvider>
      {open && <SearchMode onClose={() => setOpen(false)} />}
    </SearchProvider></CastTargetProvider></LocalSessionContext.Provider></NavProvider></MantineProvider>
  );
}

async function issueSearch(text = 'arrival') {
  await screen.findByTestId('scope-chip-all');
  const input = await screen.findByTestId('search-mode-input');
  fireEvent.change(input, { target: { value: text } });
  await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
}

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal('EventSource', MockEventSource);
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ sources: [], categories: [], providers: [] }) })));
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  controller = createLocalSessionController({ clientId: 'search-mode-lifecycle', randomUuid: () => 'search-mode-session' });
});
afterEach(() => vi.unstubAllGlobals());

describe('SearchMode streaming lifecycle', () => {
  it('shows a global service failure and retry instead of the phone empty state', async () => {
    // Break caught: the phone consumer ignores streamError and claims no
    // matches after a transport failure.
    render(<Harness />);
    await issueSearch();
    act(() => { MockEventSource.instances[0].simulateError(); });

    expect(screen.getByTestId('search-mode-stream-error')).toHaveTextContent('Lost connection to the search service.');
    expect(screen.queryByTestId('search-mode-empty')).toBeNull();
    fireEvent.click(screen.getByTestId('search-mode-stream-retry'));
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(2));
    expect(MockEventSource.instances[1].url).toContain('capability=listable');
    expect(MockEventSource.instances[1].url).toContain('scope=kids');
  });

  it('keeps partial phone results and sends the source status retry to only that failed source', async () => {
    // Break caught: SearchMode's existing status callback feeds handleInput,
    // opening a whole-query retry that discards partial result ownership.
    render(<Harness />);
    await issueSearch();
    const primary = MockEventSource.instances[0];
    act(() => {
      primary.simulateMessage({ event: 'results', source: 'plex', items: [{ id: 'plex:arrival', title: 'Arrival', source: 'plex', type: 'movie' }], pending: ['abs'] });
      primary.simulateMessage({ event: 'source_error', source: 'abs', error: 'offline', pending: [] });
      primary.simulateMessage({ event: 'complete' });
    });

    expect(await screen.findByText('Arrival')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('stream-status-retry-abs'));
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(2));
    expect(MockEventSource.instances[1].url).toContain('source=abs');
    expect(MockEventSource.instances[1].url).toContain('scope=kids');
    expect(screen.getByText('Arrival')).toBeInTheDocument();
  });

  it('keeps phone search visibly pending throughout text and scope debounce after revoking the old stream', async () => {
    // RED: unlike a dispatched SSE request, an intent waiting in the shared
    // debounce had no phone-visible pending state and fell through to empty.
    render(<Harness />);
    await screen.findByTestId('scope-chip-all');
    const input = await screen.findByTestId('search-mode-input');
    fireEvent.change(input, { target: { value: 'arrival' } });
    expect(screen.getByTestId('search-mode-loading')).toHaveTextContent('Searching...');
    expect(screen.queryByTestId('search-mode-empty')).toBeNull();

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    const oldStream = MockEventSource.instances[0];
    act(() => oldStream.simulateMessage({
      event: 'results', source: 'plex', pending: [],
      items: [{ id: 'plex:arrival', title: 'Arrival', source: 'plex', type: 'movie' }],
    }));
    expect(await screen.findByText('Arrival')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('scope-chip-family'));
    await waitFor(() => expect(oldStream.readyState).toBe(2));
    expect(screen.getByTestId('search-mode-loading')).toHaveTextContent('Searching...');
    expect(screen.queryByText('Arrival')).toBeNull();
    expect(screen.queryByTestId('search-mode-empty')).toBeNull();
  });

  it('does not tell phone users a failed widened search found nothing anywhere', async () => {
    // RED: D5's terminal wording was rendered after the widened request
    // failed, contradicting the retryable global service error.
    render(<Harness />);
    await screen.findByTestId('scope-chip-family');
    fireEvent.click(screen.getByTestId('scope-chip-family'));
    await issueSearch();
    act(() => {
      MockEventSource.instances[0].simulateMessage({ event: 'results', source: 'plex', items: [], pending: [] });
      MockEventSource.instances[0].simulateMessage({ event: 'complete' });
    });
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(2));
    act(() => MockEventSource.instances[1].simulateError());

    expect(screen.getByTestId('search-mode-stream-error')).toBeInTheDocument();
    expect(screen.queryByTestId('search-mode-widening-notice')).toBeNull();
    expect(screen.queryByText(/nothing found anywhere else either/i)).toBeNull();
    expect(screen.queryByTestId('search-mode-empty')).toBeNull();
  });

  it('keeps a twice-failed widened source retry incomplete on phone', async () => {
    // RED: named failures after a clean scoped empty took the automatic retry
    // path, yet the phone still announced a successful empty catalog search.
    render(<Harness />);
    await screen.findByTestId('scope-chip-family');
    fireEvent.click(screen.getByTestId('scope-chip-family'));
    await issueSearch();
    act(() => {
      MockEventSource.instances[0].simulateMessage({ event: 'results', source: 'plex', items: [], pending: [] });
      MockEventSource.instances[0].simulateMessage({ event: 'complete' });
    });
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(2));
    act(() => {
      MockEventSource.instances[1].simulateMessage({ event: 'source_error', source: 'plex', error: 'offline', pending: [] });
      MockEventSource.instances[1].simulateMessage({ event: 'complete' });
    });
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(3));
    expect(MockEventSource.instances[2].url).toContain('source=plex');
    act(() => {
      MockEventSource.instances[2].simulateMessage({ event: 'source_error', source: 'plex', error: 'offline', pending: [] });
      MockEventSource.instances[2].simulateMessage({ event: 'complete' });
    });

    expect(await screen.findByTestId('stream-status-retry-plex')).toBeInTheDocument();
    expect(screen.getByTestId('search-mode-widening-notice'))
      .toHaveTextContent('Not in Family — From everything: results may be incomplete. Retry the source above.');
    expect(screen.queryByText(/nothing found anywhere else either/i)).toBeNull();
    expect(screen.queryByTestId('search-mode-empty')).toBeNull();
  });
});
