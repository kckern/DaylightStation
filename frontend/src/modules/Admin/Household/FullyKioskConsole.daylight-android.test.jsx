import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const api = vi.hoisted(() => ({
  status: vi.fn(),
  settings: vi.fn(),
  action: vi.fn(),
  updateSetting: vi.fn(),
  screenshot: vi.fn(),
}));

vi.mock('./fullyKioskAdminApi.js', () => ({ default: api }));
vi.mock('../shared/feedback.js', () => ({ notifySuccess: vi.fn(), notifyFailure: vi.fn() }));

import FullyKioskConsole from './FullyKioskConsole.jsx';

const NativeURL = URL;
const daylightStatus = {
  ok: true,
  provider: 'daylight-android',
  device: { id: 'tablet', name: 'Piano tablet', address: 'kiosk.test:8780' },
  summary: { model: 'SM-T590', appVersion: '2.1.0', screenOn: true, kioskLocked: true, foregroundPackage: 'net.example.kiosk', screensaver: null },
  details: { ready: true },
  companionApps: [],
  capabilities: { actions: ['screen-on', 'screen-off', 'restart-app', 'reboot', 'refresh'] },
};
const fullyStatus = {
  ok: true,
  provider: 'fully-kiosk',
  device: { id: 'tablet', name: 'Kitchen tablet', address: 'fully.test:2323' },
  summary: { model: 'WallTab', screenOn: true },
  details: {},
  companionApps: [],
  capabilities: { actions: ['screen-on', 'screensaver-start', 'screensaver-stop', 'restart-app'] },
};
const daylightSettings = {
  ok: true,
  settings: [
    { key: 'debug.execEnabled', value: false, type: 'boolean', editable: true, sensitive: false },
    { key: 'webview.loadTimeoutSec', value: 20, type: 'number', editable: true, sensitive: false },
    { key: 'webview.userAgentSuffix', value: 'https://station.test/piano', type: 'string', editable: true, sensitive: false },
  ],
};

function renderConsole() {
  return render(
    <MantineProvider>
      <MemoryRouter initialEntries={['/admin/household/devices/tablet/fully-kiosk']}>
        <Routes>
          <Route path="/admin/household/devices/:deviceId/fully-kiosk" element={<FullyKioskConsole />} />
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.status.mockResolvedValue(daylightStatus);
  api.settings.mockResolvedValue(daylightSettings);
  api.screenshot.mockResolvedValue({ blob: new Blob(['png'], { type: 'image/png' }), capturedAt: '2026-11-16T12:00:00.000Z' });
  api.action.mockResolvedValue({ ok: true });
  api.updateSetting.mockResolvedValue({ ok: true });
  vi.stubGlobal('URL', class extends NativeURL {
    static createObjectURL = vi.fn(() => 'blob:test-shot');
    static revokeObjectURL = vi.fn();
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('kiosk console for a device on the Android kiosk app', () => {
  it('uses neutral wording and never says Fully Kiosk', async () => {
    renderConsole();
    expect(await screen.findByText('Kiosk · kiosk.test:8780')).toBeTruthy();
    expect(screen.getByText(/^Kiosk settings \(/)).toBeTruthy();
    expect(screen.getByText(/Reboot is sent through the kiosk app/)).toBeTruthy();
    expect(screen.queryByText(/Fully/)).toBeNull();
  });

  it('hides the screensaver controls and the screensaver state', async () => {
    renderConsole();
    await screen.findByText('Kiosk · kiosk.test:8780');
    expect(screen.queryByRole('button', { name: 'Screensaver' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start screensaver' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop screensaver' })).toBeNull();
    expect(screen.queryByText(/Screensaver (in)?active/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Screen on' })).toBeTruthy();
  });

  it('asks before restarting, without naming Fully', async () => {
    renderConsole();
    await screen.findByText('Kiosk · kiosk.test:8780');
    fireEvent.click(screen.getByRole('button', { name: 'Restart app' }));
    expect(await screen.findByText('Restart the kiosk app?')).toBeTruthy();
    expect(screen.queryByText(/Fully/)).toBeNull();
  });

  it('edits the settings the device lists, with no Fully-specific number ceiling', async () => {
    renderConsole();
    await screen.findByText('Kiosk · kiosk.test:8780');
    fireEvent.click(screen.getByText(/^Kiosk settings \(/));
    await screen.findByPlaceholderText('Search settings');

    const stringRow = screen.getByText('webview.userAgentSuffix').closest('tr');
    fireEvent.change(within(stringRow).getByRole('textbox'), { target: { value: 'https://station.test/home' } });
    fireEvent.click(within(stringRow).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateSetting).toHaveBeenCalledWith('tablet', 'webview.userAgentSuffix', 'https://station.test/home'));

    const numberRow = screen.getByText('webview.loadTimeoutSec').closest('tr');
    fireEvent.change(within(numberRow).getByRole('textbox'), { target: { value: '100000' } });
    fireEvent.blur(within(numberRow).getByRole('textbox'));
    fireEvent.click(within(numberRow).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateSetting).toHaveBeenCalledWith('tablet', 'webview.loadTimeoutSec', 100000));
  });
});

describe('kiosk console for a Fully device that reports its provider', () => {
  it('keeps the Fully wording and the screensaver controls', async () => {
    api.status.mockResolvedValue(fullyStatus);
    renderConsole();
    expect(await screen.findByText('Fully Kiosk · fully.test:2323')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Screensaver' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start screensaver' })).toBeTruthy();
    expect(screen.getByText(/^Fully Kiosk settings \(/)).toBeTruthy();
  });
});
