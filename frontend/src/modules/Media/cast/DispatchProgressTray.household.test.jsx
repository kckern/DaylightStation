// FIND.12a/13a/10a-AC6 and PLAY.4a through the one outcome tray: household
// list edits are named plainly, removal carries Undo, and a play that
// continued from a saved spot offers Start over on its confirmation.
import React from 'react';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

const { push, retry, removeDispatch, sendElsewhere, stopAttempt, skipLocal, startOver, recordLocal } = vi.hoisted(() => ({
  push: vi.fn(), retry: vi.fn(), removeDispatch: vi.fn(), sendElsewhere: vi.fn(), stopAttempt: vi.fn(),
  skipLocal: vi.fn(), startOver: vi.fn(), recordLocal: vi.fn(),
}));
const outcomes = new Map();
const DEVICES = [{ id: 'livingroom-tv', name: 'Living Room TV', type: 'shield-tv' }];

vi.mock('./useDispatch.js', () => ({
  useDispatch: () => ({ dispatches: outcomes, outcomes, retry, removeDispatch, sendElsewhere, stopAttempt, skipLocal, startOver, recordLocal }),
}));
vi.mock('../fleet/useDevice.js', () => ({ useDevice: (id) => ({ device: DEVICES.find(d => d.id === id) ?? null }) }));
vi.mock('../fleet/useFleetContext.js', () => ({ useFleetContext: () => ({ devices: DEVICES }) }));
vi.mock('../shell/NavProvider.jsx', () => ({ useNav: () => ({ push }) }));

import { MantineProvider } from '@mantine/core';
import { DispatchProgressTray } from './DispatchProgressTray.jsx';

const local = (overrides) => ({
  steps: [], distance: 'here', targetId: 'local', deviceId: 'local', createdAt: '2026-10-03T00:00:00.000Z', ...overrides,
});
const renderTray = () => render(<MantineProvider><DispatchProgressTray /></MantineProvider>);

describe('household outcomes in the tray', () => {
  beforeEach(() => { vi.clearAllMocks(); outcomes.clear(); vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  it('names a removal from the household list and offers Undo', () => {
    const run = vi.fn().mockResolvedValue({ ok: true });
    outcomes.set('h1', local({ attemptId: 'h1', kind: 'hide', phase: 'confirmed', item: { contentId: 'plex:1', title: 'Late Film' },
      undo: { operationId: 'hide:plex:1', expiresAt: Date.now() + 10_000, run } }));
    renderTray();
    const row = screen.getByTestId('dispatch-row-h1');
    expect(row).toHaveTextContent('Removed Late Film from the household list');
    fireEvent.click(within(row).getByTestId('item-action-undo'));
    expect(run).toHaveBeenCalled();
  });

  it.each([
    ['favourite', 'Added Bluey to favourites'],
    ['unfavourite', 'Removed Bluey from favourites'],
    ['watched', 'Marked Bluey watched'],
    ['unwatched', 'Marked Bluey unwatched'],
  ])('names a %s change', (kind, text) => {
    outcomes.set('k', local({ attemptId: 'k', kind, phase: 'confirmed', item: { contentId: 'plex:9', title: 'Bluey' } }));
    renderTray();
    expect(screen.getByTestId('dispatch-row-k')).toHaveTextContent(text);
  });

  it('a move in progress says it is moving, then that it moved', () => {
    outcomes.set('m', local({ attemptId: 'm', kind: 'moveHere', phase: 'running', item: { contentId: 'plex:9', title: 'Arrival' } }));
    const { rerender } = renderTray();
    expect(screen.getByTestId('dispatch-row-m')).toHaveTextContent('Moving Arrival here…');
    outcomes.set('m', local({ attemptId: 'm', kind: 'moveHere', phase: 'confirmed', item: { contentId: 'plex:9', title: 'Arrival' } }));
    rerender(<MantineProvider><DispatchProgressTray /></MantineProvider>);
    expect(screen.getByTestId('dispatch-row-m')).toHaveTextContent('Moved Arrival here');
  });

  it('says plainly when a household change failed', () => {
    outcomes.set('f', local({ attemptId: 'f', kind: 'favourite', phase: 'failed', reason: 'HTTP 500', item: { contentId: 'plex:9', title: 'Bluey' } }));
    renderTray();
    const row = screen.getByTestId('dispatch-row-f');
    expect(row).toHaveTextContent("Couldn't add Bluey to favourites");
    expect(within(row).queryByTestId('dispatch-retry-f')).toBeNull();
  });

  it('a play that continued from a saved spot offers Start over (here)', () => {
    outcomes.set('p', local({ attemptId: 'p', kind: 'play', phase: 'confirmed', item: { contentId: 'plex:5', title: 'Arrival' }, startOver: true, resumedFrom: 2040 }));
    renderTray();
    const row = screen.getByTestId('dispatch-row-p');
    expect(row).toHaveTextContent('Playing Arrival here');
    expect(row).toHaveTextContent('Continuing from 34 m');
    fireEvent.click(within(row).getByTestId('dispatch-start-over-p'));
    expect(startOver).toHaveBeenCalledWith('p');
  });

  it('a far play that continued offers Start over on its confirmation', () => {
    outcomes.set('fp', { attemptId: 'fp', dispatchId: 'fp', targetId: 'livingroom-tv', deviceId: 'livingroom-tv', distance: 'far', kind: 'play',
      title: 'Arrival', phase: 'confirmed', status: 'success', outcome: 'confirmed', steps: [], startOver: true });
    renderTray();
    fireEvent.click(screen.getByTestId('dispatch-start-over-fp'));
    expect(startOver).toHaveBeenCalledWith('fp');
  });

  it('keeps Start over reachable for 15 s after the confirmation', () => {
    outcomes.set('s', local({ attemptId: 's', kind: 'play', phase: 'confirmed', item: { contentId: 'plex:5', title: 'Arrival' }, startOver: true, resumedFrom: 600 }));
    renderTray();
    act(() => { vi.advanceTimersByTime(14_000); });
    expect(removeDispatch).not.toHaveBeenCalledWith('s');
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(removeDispatch).toHaveBeenCalledWith('s');
  });

  it('no Start over when nothing was resumed', () => {
    outcomes.set('n', local({ attemptId: 'n', kind: 'play', phase: 'confirmed', item: { contentId: 'plex:5', title: 'Arrival' } }));
    renderTray();
    expect(screen.queryByTestId('dispatch-start-over-n')).toBeNull();
  });
});
