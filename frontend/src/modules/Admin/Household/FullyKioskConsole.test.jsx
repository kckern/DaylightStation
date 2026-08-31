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
const statusFixture = {
  ok: true,
  device: { id: 'tablet', name: 'Kitchen tablet', address: '10.0.0.50:2323' },
  summary: {
    manufacturer: 'Acme',
    model: 'WallTab',
    androidVersion: '13',
    appVersion: '1.61',
    currentUrl: 'https://station.test/home',
    screenOn: true,
    brightness: 120,
    batteryLevel: 80,
    plugged: true,
    ssid: 'House',
    ipAddress: '10.0.0.50',
  },
  details: {
    deviceName: 'Kitchen tablet',
    currentPageUrl: 'https://station.test/home',
    serialNumber: 'ABC123',
  },
  companionApps: ['org.example.player'],
};

const settingsFixture = {
  ok: true,
  settings: [
    { key: 'keepScreenOn', value: true, type: 'boolean', editable: true, sensitive: false },
    { key: 'screenBrightness', value: 120, type: 'number', editable: true, sensitive: false },
    { key: 'startURL', value: 'https://station.test/home', type: 'url', editable: true, sensitive: false },
    { key: 'keyboardShowSuggestions', value: true, type: 'boolean', editable: false, sensitive: false },
    { key: 'remoteAdminPasswordEnc', value: null, type: 'string', editable: false, sensitive: true },
  ],
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function screenshotResult(label = 'png') {
  return {
    blob: new Blob([label], { type: 'image/png' }),
    capturedAt: '2026-08-31T12:00:00.000Z',
  };
}

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

async function ready() {
  expect(await screen.findByText('Acme WallTab')).toBeTruthy();
  return screen.findByAltText('Current screen on Kitchen tablet');
}

async function openSettings() {
  fireEvent.click(screen.getByText(/Fully Kiosk settings/));
  return screen.findByPlaceholderText('Search settings');
}

beforeEach(() => {
  vi.clearAllMocks();
  api.status.mockResolvedValue(statusFixture);
  api.settings.mockResolvedValue(settingsFixture);
  api.screenshot.mockResolvedValue(screenshotResult());
  api.action.mockResolvedValue({ ok: true });
  api.updateSetting.mockResolvedValue({ ok: true });
  let objectUrl = 0;
  vi.stubGlobal('URL', class extends NativeURL {
    static createObjectURL = vi.fn(() => `blob:test-shot-${++objectUrl}`);
    static revokeObjectURL = vi.fn();
  });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('FullyKioskConsole', () => {
  it('renders current device status, missing-field fallbacks, screenshot links, and safe quick controls', async () => {
    renderConsole();

    const image = await ready();
    expect(image).toHaveAttribute('src', 'blob:test-shot-1');
    expect(screen.getByText('Online')).toBeTruthy();
    expect(screen.getAllByText(/Not reported/).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Full size' })).toHaveAttribute('href', 'blob:test-shot-1');
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute('download', 'tablet-screenshot.png');

    fireEvent.click(screen.getByRole('button', { name: 'Screen on' }));
    await waitFor(() => expect(api.action).toHaveBeenCalledWith('tablet', 'screen-on', {}));
    await waitFor(() => expect(api.status).toHaveBeenCalledTimes(2));
  });

  it('does not turn absent telemetry into false device state', async () => {
    api.status.mockResolvedValueOnce({
      ...statusFixture,
      summary: { manufacturer: 'Acme', model: 'WallTab' },
      details: {},
    });
    renderConsole();
    await screen.findByText('Acme WallTab');

    expect(screen.getByText('Screen not reported')).toBeTruthy();
    expect(screen.queryByText('On battery')).toBeNull();
    expect(screen.queryByText('Unlocked')).toBeNull();
    expect(screen.queryByText('Screensaver inactive')).toBeNull();
    expect(screen.getAllByText('Not reported').length).toBeGreaterThan(3);
  });

  it('sends typed action payloads and permits independent commands while another action is pending', async () => {
    renderConsole();
    await ready();

    fireEvent.change(screen.getByLabelText('Brightness'), { target: { value: '200' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Apply' })[0]);
    await waitFor(() => expect(api.action).toHaveBeenCalledWith('tablet', 'set-brightness', { level: 200 }));

    fireEvent.change(screen.getByLabelText('Load URL'), { target: { value: 'https://example.test/page' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    await waitFor(() => expect(api.action).toHaveBeenCalledWith('tablet', 'load-url', {
      url: 'https://example.test/page',
    }));

    fireEvent.change(screen.getByLabelText('Speak'), { target: { value: 'Hello kitchen' } });
    fireEvent.change(screen.getByLabelText('Locale (optional)'), { target: { value: 'en-US' } });
    fireEvent.click(screen.getByRole('button', { name: 'Speak' }));
    await waitFor(() => expect(api.action).toHaveBeenCalledWith('tablet', 'speak', {
      text: 'Hello kitchen',
      locale: 'en-US',
    }));

    const pending = deferred();
    api.action.mockImplementation((_deviceId, action) => (
      action === 'screen-on' ? pending.promise : Promise.resolve({ ok: true })
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Screen on' }));
    await waitFor(() => expect(api.action).toHaveBeenCalledWith('tablet', 'screen-on', {}));
    fireEvent.click(screen.getByRole('button', { name: 'Screen off' }));
    await waitFor(() => expect(api.action).toHaveBeenCalledWith('tablet', 'screen-off', {}));
    pending.resolve({ ok: true });
    await waitFor(() => expect(api.status).toHaveBeenCalledTimes(6));
  });

  it.each([
    ['Reset WebView', 'Reset WebView?', 'Reset WebView', 'reset-webview'],
    ['Restart app', 'Restart Fully Kiosk?', 'Restart app', 'restart-app'],
    ['Unlock kiosk', 'Unlock kiosk mode?', 'Unlock kiosk', 'kiosk-unlock'],
    ['Maintenance on', 'Enable maintenance mode?', 'Enable maintenance', 'maintenance-enable'],
    ['Reboot device', 'Reboot device?', 'Reboot', 'reboot'],
  ])('requires confirmation before %s', async (button, title, confirm, action) => {
    renderConsole();
    await ready();

    fireEvent.click(screen.getByRole('button', { name: button }));
    expect(await screen.findByText(title)).toBeTruthy();
    expect(api.action).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: confirm }));
    await waitFor(() => expect(api.action).toHaveBeenCalledWith('tablet', action, {}));
    await waitFor(() => expect(api.status).toHaveBeenCalledTimes(2));
  });

  it('shows action failures without discarding the last known device status', async () => {
    api.action.mockRejectedValueOnce(new Error('Device refused the command'));
    renderConsole();
    await ready();

    fireEvent.click(screen.getByRole('button', { name: 'Screen off' }));
    expect(await screen.findByText('Device refused the command')).toBeTruthy();
    expect(screen.getByText('Acme WallTab')).toBeTruthy();
  });

  it('shows all settings, masks credentials, filters rows, and saves boolean, number, and URL drafts', async () => {
    renderConsole();
    await ready();
    const search = await openSettings();

    expect(screen.getByText('remoteAdminPasswordEnc')).toBeTruthy();
    expect(screen.getByText('••••••')).toBeTruthy();
    expect(screen.getByText('Masked')).toBeTruthy();
    expect(screen.getByText('Read only')).toBeTruthy();

    fireEvent.change(search, { target: { value: 'remoteAdmin' } });
    expect(screen.queryByText('keepScreenOn')).toBeNull();
    expect(screen.getByText('remoteAdminPasswordEnc')).toBeTruthy();
    fireEvent.change(search, { target: { value: '' } });

    const booleanRow = screen.getByText('keepScreenOn').closest('tr');
    fireEvent.click(within(booleanRow).getByRole('switch'));
    fireEvent.click(within(booleanRow).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateSetting).toHaveBeenCalledWith('tablet', 'keepScreenOn', false));
    await waitFor(() => expect(api.settings).toHaveBeenCalledTimes(2));

    const numberRow = screen.getByText('screenBrightness').closest('tr');
    fireEvent.change(within(numberRow).getByRole('textbox'), { target: { value: '144' } });
    fireEvent.click(within(numberRow).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateSetting).toHaveBeenCalledWith('tablet', 'screenBrightness', 144));
    await waitFor(() => expect(api.settings).toHaveBeenCalledTimes(3));

    const urlRow = screen.getByText('startURL').closest('tr');
    fireEvent.change(within(urlRow).getByRole('textbox'), { target: { value: 'https://example.test/new' } });
    fireEvent.click(within(urlRow).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateSetting).toHaveBeenCalledWith(
      'tablet',
      'startURL',
      'https://example.test/new',
    ));
    await waitFor(() => expect(api.settings).toHaveBeenCalledTimes(4));
  });

  it('filters the searchable full information table', async () => {
    renderConsole();
    await ready();
    fireEvent.click(screen.getByText(/Full device information/));
    const search = await screen.findByPlaceholderText('Search device information');

    expect(screen.getByText('serialNumber')).toBeTruthy();
    fireEvent.change(search, { target: { value: 'serial' } });
    expect(screen.getByText('serialNumber')).toBeTruthy();
    expect(screen.queryByText('deviceName')).toBeNull();
  });

  it('replaces and revokes screenshot object URLs, then clears stale imagery on failure', async () => {
    renderConsole();
    expect(await ready()).toHaveAttribute('src', 'blob:test-shot-1');

    api.screenshot.mockResolvedValueOnce(screenshotResult('new'));
    fireEvent.click(screen.getByRole('button', { name: 'Capture' }));
    await waitFor(() => expect(screen.getByAltText('Current screen on Kitchen tablet'))
      .toHaveAttribute('src', 'blob:test-shot-2'));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-shot-1');

    api.screenshot.mockRejectedValueOnce(new Error('Screenshot timed out'));
    fireEvent.click(screen.getByRole('button', { name: 'Capture' }));
    expect(await screen.findByText('Screenshot timed out')).toBeTruthy();
    expect(screen.queryByAltText('Current screen on Kitchen tablet')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-shot-2');
  });

  it('runs 5-second screenshot refresh without overlap and aborts/cleans up on unmount', async () => {
    const rendered = renderConsole();
    await ready();
    const pending = deferred();
    api.screenshot.mockImplementationOnce(() => pending.promise);
    vi.useFakeTimers();

    fireEvent.click(screen.getByRole('switch', { name: 'Every 5s' }));
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(api.screenshot).toHaveBeenCalledTimes(2);
    const signal = api.screenshot.mock.calls[1][1].signal;
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(api.screenshot).toHaveBeenCalledTimes(2);

    rendered.unmount();
    expect(signal.aborted).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-shot-1');
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(api.screenshot).toHaveBeenCalledTimes(2);
    pending.resolve(screenshotResult('late'));
    await act(async () => Promise.resolve());
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('shows Offline after a failed refresh while preserving the last successful status', async () => {
    renderConsole();
    await ready();
    api.status.mockRejectedValueOnce(new Error('Device timed out'));

    fireEvent.click(screen.getByRole('button', { name: 'Refresh device' }));
    await waitFor(() => expect(api.status).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Offline')).toBeTruthy();
    expect(screen.getByText('Device timed out')).toBeTruthy();
    expect(screen.getByText('Acme WallTab')).toBeTruthy();
  });
});
