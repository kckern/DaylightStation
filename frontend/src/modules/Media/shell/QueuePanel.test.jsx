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
