import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, test, expect, beforeEach, describe } from 'vitest';
import { ResultRow } from './ResultRow.jsx';
import { LocalSessionContext } from '../session/LocalSessionContext.js';
import { NavProvider } from '../shell/NavProvider.jsx';
import { FleetContext } from '../fleet/FleetProvider.jsx';
import { DispatchContext } from '../cast/DispatchProvider.jsx';
import { CastTargetContext } from '../cast/CastTargetProvider.jsx';

const queueMock = {
  playNow: vi.fn(), playNext: vi.fn(), addUpNext: vi.fn(), add: vi.fn(),
};
const adapter = {
  getSnapshot: () => ({ state: 'idle', currentItem: null, position: 0, queue: { items: [], currentIndex: -1, upNextCount: 0 }, config: {}, meta: { updatedAt: '', ownerId: 't' } }),
  subscribe: () => () => {},
  transport: {}, queue: queueMock, config: {}, lifecycle: {}, portability: {},
};
const devices = { 'living-tv': { id: 'living-tv', name: 'Living Room TV', location: 'living' } };

function wrap(children) {
  return (
    <LocalSessionContext.Provider value={{ adapter }}>
      <NavProvider>
        <FleetContext.Provider value={{ devices, byDevice: new Map(), loading: false, error: null, refresh: () => {} }}>
          <CastTargetContext.Provider value={{ targetIds: [], mode: 'transfer', setMode: () => {}, toggleTarget: () => {}, clearTargets: () => {} }}>
            <DispatchContext.Provider value={{ dispatches: {}, dispatchToTarget: vi.fn(), retryLast: () => {} }}>
              {children}
            </DispatchContext.Provider>
          </CastTargetContext.Provider>
        </FleetContext.Provider>
      </NavProvider>
    </LocalSessionContext.Provider>
  );
}

const row = { id: 'plex:7', title: 'Test Show', thumbnail: null };

beforeEach(() => { Object.values(queueMock).forEach((m) => m.mockClear()); });

test('renders title, thumbnail, and primary actions', () => {
  render(wrap(<ResultRow row={row} />));
  expect(screen.getByText('Test Show')).toBeInTheDocument();
  expect(screen.getByTestId('result-play-now-plex:7')).toBeInTheDocument();
  expect(screen.getByTestId('result-add-plex:7')).toBeInTheDocument();
});

test('Play Now calls queue.playNow with clearRest', () => {
  render(wrap(<ResultRow row={row} />));
  fireEvent.click(screen.getByTestId('result-play-now-plex:7'));
  expect(queueMock.playNow).toHaveBeenCalledWith(expect.objectContaining({ contentId: 'plex:7' }), { clearRest: true });
});

test('clicking the title toggles inline peek (does not navigate)', () => {
  render(wrap(<ResultRow row={row} />));
  fireEvent.click(screen.getByTestId('result-open-plex:7'));
  expect(screen.getByTestId('result-peek-plex:7')).toBeInTheDocument();
  // Toggling closes it
  fireEvent.click(screen.getByTestId('result-open-plex:7'));
  expect(screen.queryByTestId('result-peek-plex:7')).not.toBeInTheDocument();
});

test('peek contains the Cast trigger that opens the DispatchTargetPicker', () => {
  render(wrap(<ResultRow row={row} />));
  fireEvent.click(screen.getByTestId('result-open-plex:7'));
  fireEvent.click(screen.getByTestId('cast-button-plex:7'));
  expect(screen.getByTestId('dispatch-target-picker')).toBeInTheDocument();
});

test('does NOT call onAction for Add — search stays open', () => {
  const onAction = vi.fn();
  render(wrap(<ResultRow row={row} onAction={onAction} />));
  fireEvent.click(screen.getByTestId(`result-add-${row.id}`));
  expect(queueMock.add).toHaveBeenCalled();
  expect(onAction).not.toHaveBeenCalled();
});

test('flashes confirmation text on the clicked button', () => {
  render(wrap(<ResultRow row={row} onAction={vi.fn()} />));
  fireEvent.click(screen.getByTestId(`result-add-${row.id}`));
  expect(screen.getByTestId(`result-add-${row.id}`)).toHaveTextContent('✓ Added');
});

test('still calls onAction for Play Now (playback starts, overlay closes)', () => {
  const onAction = vi.fn();
  render(wrap(<ResultRow row={row} onAction={onAction} />));
  fireEvent.click(screen.getByTestId(`result-play-now-${row.id}`));
  expect(onAction).toHaveBeenCalled();
});
