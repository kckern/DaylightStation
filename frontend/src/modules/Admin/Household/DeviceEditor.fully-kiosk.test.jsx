import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { UnsavedGuardProvider } from '../shared/UnsavedGuardContext.jsx';

const daylightApi = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: daylightApi }));

import DeviceEditor from './DeviceEditor.jsx';

function renderEditor(device) {
  daylightApi.mockResolvedValueOnce({ device });
  return render(
    <MantineProvider>
      <MemoryRouter initialEntries={['/admin/household/devices/tablet']}>
        <UnsavedGuardProvider>
          <Routes>
            <Route path="/admin/household/devices/:deviceId" element={<DeviceEditor />} />
          </Routes>
        </UnsavedGuardProvider>
      </MemoryRouter>
    </MantineProvider>,
  );
}

afterEach(() => {
  cleanup();
  daylightApi.mockReset();
});

describe('DeviceEditor Fully Kiosk entry point', () => {
  it('shows the console link only for Fully Kiosk configured devices', async () => {
    renderEditor({
      id: 'tablet',
      type: 'shield-tv',
      content_control: { provider: 'fully-kiosk', host: '10.0.0.50' },
    });
    expect(await screen.findByRole('button', { name: 'Fully Kiosk Console' })).toBeTruthy();
  });

  it('does not show the console link for other content providers', async () => {
    renderEditor({ id: 'tablet', type: 'linux-pc', content_control: { provider: 'websocket' } });
    await screen.findByText('tablet');
    expect(screen.queryByRole('button', { name: 'Fully Kiosk Console' })).toBeNull();
  });
});
