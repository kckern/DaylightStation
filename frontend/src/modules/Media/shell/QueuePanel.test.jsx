import React from 'react';
import { it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { Notifications, notifications } from '@mantine/notifications';
import { QueuePanel } from './QueuePanel.jsx';
import { LocalSessionContext } from '../session/LocalSessionContext.js';
import { createLocalSessionController } from '../session/LocalSessionController.js';

it('removes a queue entry and restores it through ordinary Undo', async () => {
  notifications.clean();
  const controller = createLocalSessionController({ clientId: 'queue-test' });
  controller.queue.playNow({ contentId: 'one', title: 'One', format: 'video' });
  controller.queue.add({ contentId: 'two', title: 'Two', format: 'video' });
  const secondId = controller.getSnapshot().queue.items[1].queueItemId;
  render(<MantineProvider><LocalSessionContext.Provider value={{ controller }}><QueuePanel /><Notifications /></LocalSessionContext.Provider></MantineProvider>);
  fireEvent.click(screen.getByTestId(`queue-remove-${secondId}`));
  expect(controller.getSnapshot().queue.items).toHaveLength(1);
  fireEvent.click(await screen.findByRole('button', { name: 'Undo', exact: true }));
  await waitFor(() => expect(controller.getSnapshot().queue.items[1].queueItemId).toBe(secondId));
});
