import React from 'react';
import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueuePanel } from './QueuePanel.jsx';
import { LocalSessionContext } from '../session/LocalSessionContext.js';
import { createLocalSessionController } from '../session/LocalSessionController.js';
import { DispatchProvider } from '../cast/DispatchProvider.jsx';
import { DispatchProgressTray } from '../cast/DispatchProgressTray.jsx';
import { FleetContext } from '../fleet/FleetProvider.jsx';
import { createFleetStore } from '../fleet/fleetStore.js';

vi.mock('./NavProvider.jsx', () => ({ useNav: () => ({ push: vi.fn() }) }));
vi.mock('../household/PlayedEarlier.jsx', () => ({ PlayedEarlier: () => null }));
vi.mock('../net/ws.js', () => ({ subscribeTopicKind: () => () => {}, parseDeviceTopic: () => null }));

it('removes a queue entry, reports it through the outcome tray, and restores it through ordinary Undo', async () => {
  const controller = createLocalSessionController({ clientId: 'queue-test' });
  controller.queue.playNow({ contentId: 'one', title: 'One', format: 'video' });
  controller.queue.add({ contentId: 'two', title: 'Two', format: 'video' });
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
  fireEvent.click(screen.getByTestId(`queue-remove-${secondId}`));
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
  expect(screen.getByTestId('queue-end-stop')).toHaveAttribute('aria-checked', 'true');
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
