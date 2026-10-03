// RELY.8a — Start fresh lists exactly what will be cleared, keeps what the
// person unticks, and asks first.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

vi.mock('../logging/mediaLog.js', () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});
const clearTargets = vi.fn();
let aim = { targetIds: ['office-tv'] };
vi.mock('../cast/useCastTarget.js', () => ({ useCastTarget: () => ({ ...aim, clearTargets }) }));
vi.mock('../fleet/useFleetContext.js', () => ({ useFleetContext: () => ({ devices: [{ id: 'office-tv', name: 'Office TV' }] }) }));

import { LocalSessionContext } from '../session/LocalSessionContext.js';
import { createLocalSessionController } from '../session/LocalSessionController.js';
import { StartFreshDialog } from './StartFreshDialog.jsx';

const entry = (id, title) => ({ queueItemId: `q-${id}`, contentId: `plex:${id}`, format: 'audio', title, duration: 600, priority: 'queue', addedAt: '' });
function controller() {
  const c = createLocalSessionController({
    clientId: 'c1', randomUuid: () => 'fresh',
    persistedSnapshot: {
      sessionId: 's', state: 'paused', currentItem: { contentId: 'plex:1', format: 'audio', title: 'Arrival', duration: 600 }, position: 125,
      queue: { items: [entry(1, 'Arrival'), entry(2, 'Nova'), entry(3, 'Dune')], currentIndex: 0, upNextCount: 0 },
      config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
      meta: { ownerId: 'c1', updatedAt: '2026-10-01T00:00:00.000Z' },
    },
  });
  c.setPlayerHandle({ play: vi.fn(), pause: vi.fn(), seek: vi.fn() });
  return c;
}
function renderDialog(c, onClose = vi.fn()) {
  render(
    <MantineProvider>
      <LocalSessionContext.Provider value={{ controller: c }}>
        <StartFreshDialog open onClose={onClose} />
      </LocalSessionContext.Provider>
    </MantineProvider>,
  );
  return onClose;
}

beforeEach(() => { vi.clearAllMocks(); aim = { targetIds: ['office-tv'] }; });

describe('StartFreshDialog', () => {
  it('lists what is playing, the queue, the spot and the aim, all to be cleared by default', () => {
    renderDialog(controller());
    const dialog = screen.getByTestId('confirm-dialog');
    expect(within(dialog).getByRole('checkbox', { name: /What's playing: Arrival/ })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: /Queue: 2 more items/ })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: /Spot: 2:05 into Arrival/ })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: /Aim: Office TV/ })).toBeChecked();
  });

  it('nothing changes until confirmed', () => {
    const c = controller();
    const onClose = renderDialog(c);
    fireEvent.click(screen.getByTestId('confirm-cancel'));
    expect(onClose).toHaveBeenCalled();
    expect(c.getSnapshot().currentItem.contentId).toBe('plex:1');
    expect(clearTargets).not.toHaveBeenCalled();
  });

  it('keeps the parts the person unticks', () => {
    const c = controller();
    renderDialog(c);
    fireEvent.click(screen.getByRole('checkbox', { name: /Queue: 2 more items/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Aim: Office TV/ }));
    fireEvent.click(screen.getByTestId('confirm-ok'));
    expect(c.getSnapshot().currentItem).toBeNull();
    expect(c.getSnapshot().queue.items.map(e => e.contentId)).toEqual(['plex:2', 'plex:3']);
    expect(clearTargets).not.toHaveBeenCalled();
  });

  it('clearing everything reads as new and returns the aim here', () => {
    const c = controller();
    renderDialog(c);
    fireEvent.click(screen.getByTestId('confirm-ok'));
    expect(c.getSnapshot().sessionId).toBe('fresh');
    expect(c.getSnapshot().queue.items).toEqual([]);
    expect(clearTargets).toHaveBeenCalled();
  });

  it('a spot can be kept only together with what is playing', () => {
    renderDialog(controller());
    const spot = screen.getByRole('checkbox', { name: /Spot:/ });
    expect(spot).toBeDisabled();
    expect(screen.getByText(/kept only with what's playing/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /What's playing/ }));
    expect(spot).toBeEnabled();
    fireEvent.click(spot);
    expect(spot).not.toBeChecked();
  });
});
