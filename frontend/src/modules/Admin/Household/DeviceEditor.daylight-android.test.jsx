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

describe('DeviceEditor Android kiosk app entry point', () => {
  it('shows a console link for a device on the Android kiosk app', async () => {
    renderEditor({
      id: 'tablet',
      type: 'tablet',
      content_control: { provider: 'daylight-android', host: 'kiosk.test' },
    });
    expect(await screen.findByRole('button', { name: 'Kiosk Console' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Fully Kiosk Console' })).toBeNull();
  });

  it('keeps the Fully Kiosk label for a Fully device', async () => {
    renderEditor({
      id: 'tablet',
      type: 'shield-tv',
      content_control: { provider: 'fully-kiosk', host: 'fully.test' },
    });
    expect(await screen.findByRole('button', { name: 'Fully Kiosk Console' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Kiosk Console' })).toBeNull();
  });
});
