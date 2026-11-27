import React from 'react';
import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueuePanel } from "./QueuePanel.jsx";
import { LocalSessionContext } from "../session/LocalSessionContext.js";
import { createLocalSessionController } from "../session/LocalSessionController.js";
import { DispatchProvider } from "../cast/DispatchProvider.jsx";
import { DispatchProgressTray } from "../cast/DispatchProgressTray.jsx";
import { FleetContext } from "../fleet/FleetProvider.jsx";
import { createFleetStore } from "../fleet/fleetStore.js";
import { PeekContext } from "../peek/PeekContext.js";
import { NavContext } from "./navContext.js";

vi.mock("./NavProvider.jsx", () => ({ useNav: () => ({ push: vi.fn() }) }));
vi.mock("../household/PlayedEarlier.jsx", async () => {
  const { useState } = await import('react');
  return {
    PlayedEarlier: ({ screenId }) => {
      const [mountedFor] = useState(screenId);
      if (!screenId.startsWith('tv-')) return null;
      return <span data-testid="played-history-owner">{mountedFor}</span>;
    },
  };
});
vi.mock("../net/ws.js", () => ({ subscribeTopicKind: () => () => {}, parseDeviceTopic: () => null }));

it('resets played-history local state when QueuePanel changes remote screen owner', () => {
  const snapshots = {
    'tv-a': { state: 'ready', currentItem: { contentId: 'track:one' }, queue: { items: [] }, config: {} },
    'tv-b': { state: 'ready', currentItem: { contentId: 'track:one' }, queue: { items: [] }, config: {} },
  };
  const controllers = Object.fromEntries(Object.entries(snapshots).map(([id, snapshot]) => [id, {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    queue: {},
    config: {},
  }]));
  const peek = { getController: id => controllers[id] };
  const view = render(
    <MantineProvider>
      <PeekContext.Provider value={peek}>
        <FleetContext.Provider value={{ store: createFleetStore(), devices: [] }}>
          <DispatchProvider><QueuePanel target={{ deviceId: 'tv-a' }} /></DispatchProvider>
        </FleetContext.Provider>
      </PeekContext.Provider>
    </MantineProvider>,
  );
  expect(screen.getByTestId('played-history-owner')).toHaveTextContent('tv-a');
  view.rerender(
    <MantineProvider>
      <PeekContext.Provider value={peek}>
        <FleetContext.Provider value={{ store: createFleetStore(), devices: [] }}>
          <DispatchProvider><QueuePanel target={{ deviceId: 'tv-b' }} /></DispatchProvider>
        </FleetContext.Provider>
      </PeekContext.Provider>
    </MantineProvider>,
  );
  expect(screen.getByTestId('played-history-owner')).toHaveTextContent('tv-b');
});

it('removes a queue entry, reports it through the outcome tray, and restores it through ordinary Undo', async () => {
  const controller = createLocalSessionController({ clientId: 'queue-test' });
  controller.queue.playNow({ contentId: 'two-first', title: 'Two', format: 'video' });
  controller.queue.add({ contentId: 'two-second', title: 'Two', format: 'video' });
  const secondId = controller.getSnapshot().queue.items[1].queueItemId;
  render(
    <MantineProvider>
      <LocalSessionContext.Provider value={{ controller }}>
        <FleetContext.Provider value={{ store: createFleetStore(), devices: [] }}>
          <DispatchProvider><QueuePanel /><DispatchProgressTray /></DispatchProvider>
        </FleetContext.Provider>
      </LocalSessionContext.Provider>
    </MantineProvider>,
  );
  // A row's edits are in its ⋯ (the row itself opens the info view).
  fireEvent.click(screen.getByRole('button', { name: 'More for item 2, Two' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from queue: item 2, Two' }));
  expect(controller.getSnapshot().queue.items).toHaveLength(1);
  expect(await screen.findByTestId('dispatch-tray')).toHaveTextContent('Removed Two from the queue here');
  fireEvent.click(await screen.findByTestId('item-action-undo'));
  await waitFor(() => expect(controller.getSnapshot().queue.items[1].queueItemId).toBe(secondId));
});

it('marks items "keep similar playing" added, and shows the end-of-queue choice at the bottom (STEER.13a)', async () => {
  const controller = createLocalSessionController({ clientId: 'queue-auto', sessionControls: { storage: null } });
  controller.queue.playNow({ contentId: 'one', title: 'One', format: 'audio' });
  controller.queue.add({ contentId: 'auto', title: 'Auto', format: 'audio', addedBy: 'auto-continue' });
  const [first, auto] = controller.getSnapshot().queue.items;
  render(
    <MantineProvider>
      <LocalSessionContext.Provider value={{ controller }}>
        <FleetContext.Provider value={{ store: createFleetStore(), devices: [] }}>
          <DispatchProvider><QueuePanel /></DispatchProvider>
        </FleetContext.Provider>
      </LocalSessionContext.Provider>
    </MantineProvider>,
  );
  expect(screen.getByTestId(`queue-auto-${auto.queueItemId}`)).toHaveTextContent('added automatically');
  expect(screen.queryByTestId(`queue-auto-${first.queueItemId}`)).toBeNull();
  const choice = screen.getByTestId('queue-end-choice');
  expect(screen.getByTestId('queue-panel').lastElementChild).toBe(choice);
  expect(screen.getByTestId('queue-end-stop').querySelector('input').checked).toBe(true);
});

it('shows no queue for a live channel (no Shuffle, Repeat or Clear), but keeps a live item that has a real queue behind it (STEER.7a/AC4)', () => {
  const live = createLocalSessionController({ clientId: 'queue-live' });
  live.queue.playNow({ contentId: 'live:news', title: 'News channel', format: 'video', isLive: true });
  const mount = (controller) => render(
    <MantineProvider>
      <LocalSessionContext.Provider value={{ controller }}>
        <FleetContext.Provider value={{ store: createFleetStore(), devices: [] }}>
          <DispatchProvider><QueuePanel /></DispatchProvider>
        </FleetContext.Provider>
      </LocalSessionContext.Provider>
    </MantineProvider>,
  );
  const first = mount(live);
  expect(live.getSnapshot().currentItem.isLive).toBe(true);
  expect(screen.queryByTestId('queue-panel')).toBeNull();
  expect(screen.queryByTestId('queue-shuffle')).toBeNull();
  expect(screen.queryByTestId('queue-clear')).toBeNull();
  first.unmount();
  live.queue.add({ contentId: 'two', title: 'Two', format: 'video' });
  mount(live);
  expect(screen.getByTestId('queue-panel')).toBeInTheDocument();
});

it('the whole play order: what played folds into "3 played", the current row reads Now, the next five, then More', () => {
  const items = Array.from({ length: 12 }, (_, i) => ({ queueItemId: `q${i}`, contentId: `c${i}`, title: `Song ${i}` }));
  const snapshot = { state: 'playing', currentItem: { contentId: 'c3' }, queue: { items, currentIndex: 3 }, config: {} };
  const controller = { getSnapshot: () => snapshot, subscribe: () => () => {}, queue: {}, config: {} };
  render(
    <MantineProvider>
      <PeekContext.Provider value={{ getController: () => controller }}>
        <FleetContext.Provider value={{ store: createFleetStore(), devices: [] }}>
          <DispatchProvider><QueuePanel target={{ deviceId: 'tv-a' }} /></DispatchProvider>
        </FleetContext.Provider>
      </PeekContext.Provider>
    </MantineProvider>,
  );
  const shown = () => screen.getAllByTestId(/^queue-item-q/).map((el) => el.dataset.testid.replace('queue-item-', ''));
  expect(shown()).toEqual(['q3', 'q4', 'q5', 'q6', 'q7', 'q8']);
  expect(screen.getByTestId('queue-item-q3')).toHaveAttribute('aria-current', 'true');
  expect(screen.getByTestId('queue-item-q3')).toHaveTextContent('Now');
  // Earlier items are not lost: one row says how many, and opens in place, in order.
  expect(screen.getByTestId('queue-earlier')).toHaveTextContent('3 played');
  fireEvent.click(screen.getByTestId('queue-earlier'));
  expect(screen.getByTestId('queue-earlier')).toHaveAttribute('aria-expanded', 'true');
  expect(shown()).toEqual(['q0', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8']);
  expect(screen.getByTestId('queue-more')).toHaveTextContent('More (3)');
  fireEvent.click(screen.getByTestId('queue-more'));
  expect(shown()).toEqual(items.map((it) => it.queueItemId));
});

it('a row opens its info view; its ⋯ holds Play Now and the edits from the one menu table', () => {
  const push = vi.fn();
  const items = Array.from({ length: 3 }, (_, i) => ({ queueItemId: `q${i}`, contentId: `c${i}`, title: `Song ${i}` }));
  const snapshot = { state: 'playing', currentItem: { contentId: 'c0' }, queue: { items, currentIndex: 0 }, config: {} };
  const jump = vi.fn();
  const controller = { getSnapshot: () => snapshot, subscribe: () => () => {}, queue: { jump }, config: {} };
  render(
    <MantineProvider>
      <NavContext.Provider value={{ push }}>
        <PeekContext.Provider value={{ getController: () => controller }}>
          <FleetContext.Provider value={{ store: createFleetStore(), devices: [] }}>
            <DispatchProvider><QueuePanel target={{ deviceId: 'tv-a' }} /></DispatchProvider>
          </FleetContext.Provider>
        </PeekContext.Provider>
      </NavContext.Provider>
    </MantineProvider>,
  );
  fireEvent.click(screen.getByTestId('queue-open-q1'));
  expect(push).toHaveBeenCalledWith('detail', { contentId: 'c1' });
  fireEvent.click(screen.getByTestId('queue-menu-q1'));
  expect(screen.getAllByRole('menuitem').map((el) => el.textContent)).toEqual(['Play Now', 'Move up', 'Move down', 'Remove from queue', 'Open detail']);
  fireEvent.click(screen.getByTestId('queue-jump-q1'));
  expect(jump).toHaveBeenCalledWith('q1');
});
