import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

// ops:docs/superpowers/specs/2026-11-26-phone-downloads-lifecycle.md §3.2.
const apiMock = vi.fn();
vi.mock("../../../../../frontend/src/lib/api.mjs", () => ({ DaylightAPI: (...args) => apiMock(...args) }));
let devices = [];
vi.mock("../fleet/useDevices.js", () => ({ useDevices: () => ({ devices, loading: false, error: null, refresh: () => {} }) }));
vi.mock("../shell/NavProvider.jsx", () => ({ useNav: () => ({ pop: vi.fn(), push: vi.fn(), backDestination: 'Devices' }) }));
vi.mock("../logging/mediaLog.js", () => {
  const fn = () => vi.fn();
  const log = new Proxy({}, { get: (t, k) => (t[k] ??= fn()) });
  return { default: log, mediaLog: log };
});

import { PhoneKeepsProvider, usePhoneKeeps, useWatchPhoneKeeps, KEEPS_REFRESH_MS } from './usePhoneKeeps.jsx';
import { DispatchContext } from './DispatchProvider.jsx';
import { PhoneKeepsView } from '../house/PhoneKeepsView.jsx';

const A = 'install-aaaa-1111';
const phone = { id: 'phone', name: 'Phone', type: 'phone', content_control: { provider: 'phone-inbox' } };
const keepsView = (over = {}) => ({ ok: true, installs: [{ installId: A, model: 'SM-S921U', current: true, live: true }], waiting: [], received: [], refused: [], kept: { [A]: { items: [] } }, ...over });

function Watcher({ item }) { useWatchPhoneKeeps(item); return null; }
let captured;
function Capture() { captured = usePhoneKeeps(); return null; }

function renderWith(children, outcomes = null) {
  return render(
    <MantineProvider>
      <DispatchContext.Provider value={outcomes}>
        <PhoneKeepsProvider>{children}<Capture /></PhoneKeepsProvider>
      </DispatchContext.Provider>
    </MantineProvider>,
  );
}

describe('PhoneKeepsProvider', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); apiMock.mockReset(); devices = [phone]; });
  afterEach(() => { vi.useRealTimers(); });

  it('reads nothing while nothing keepable is shown', async () => {
    apiMock.mockResolvedValue(keepsView());
    renderWith(<Watcher item={{ id: 'plex:1', type: 'movie' }} />);
    await act(async () => { vi.advanceTimersByTime(KEEPS_REFRESH_MS * 3); });
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('reads while a keepable item is shown, every 20 s, never two at once, and stops when it goes', async () => {
    let release;
    apiMock.mockImplementation(() => new Promise((r) => { release = () => r(keepsView()); }));
    const { rerender } = renderWith(<Watcher item={{ id: 'plex:1', type: 'album' }} />);
    expect(apiMock).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(KEEPS_REFRESH_MS); });
    expect(apiMock).toHaveBeenCalledTimes(1); // the first read is still in flight
    await act(async () => { release(); });
    await act(async () => { vi.advanceTimersByTime(KEEPS_REFRESH_MS); });
    expect(apiMock).toHaveBeenCalledTimes(2);
    await act(async () => { release(); });
    rerender(<MantineProvider><DispatchContext.Provider value={null}><PhoneKeepsProvider><Capture /></PhoneKeepsProvider></DispatchContext.Provider></MantineProvider>);
    const before = apiMock.mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(KEEPS_REFRESH_MS * 3); });
    expect(apiMock.mock.calls.length).toBe(before);
  });

  it('a failed request is on the outcome tray with Retry, and Retry asks again', async () => {
    const outcomes = { recordLocal: vi.fn(() => 'att-1'), resolveLocal: vi.fn(), removeDispatch: vi.fn() };
    apiMock.mockImplementation((url, data, method) => (method === 'POST'
      ? Promise.reject(Object.assign(new Error('HTTP 503'), { status: 503 }))
      : Promise.resolve(keepsView())));
    renderWith(null, outcomes);
    await act(async () => { captured.run(`keepOn:phone@${A}`, { id: 'plex:9', title: 'A book' }); });
    await waitFor(() => expect(outcomes.resolveLocal).toHaveBeenCalledWith('att-1', expect.objectContaining({ phase: 'failed', reason: 'Home could not save it just now' })));
    expect(outcomes.recordLocal).toHaveBeenCalledWith(expect.objectContaining({ kind: 'keepOnPhone', targetName: 'Phone' }));
    const { retryAction } = outcomes.resolveLocal.mock.calls.find((c) => c[1].phase === 'failed')[1];
    const posts = () => apiMock.mock.calls.filter((c) => c[2] === 'POST').length;
    const n = posts();
    await act(async () => { retryAction(); });
    await waitFor(() => expect(posts()).toBe(n + 1));
    expect(outcomes.removeDispatch).toHaveBeenCalledWith('att-1');
  });

  it('the phone page lists what is kept with sizes, room, waiting keeps and Remove', async () => {
    apiMock.mockImplementation((url, data, method) => Promise.resolve(method === 'POST' ? { ok: true } : keepsView({
      kept: { [A]: { items: [{ contentId: 'plex:2', title: 'Big', state: 'ready', bytes: 900e6 }, { contentId: 'plex:1', title: 'Small', state: 'downloading', done: 1, total: 4, bytes: 10e6 }], freeBytes: 15e9, limitBytes: 4e9 } },
      waiting: [{ command: 'keep', commandId: 'k1', contentId: 'plex:3', title: 'Next', installId: A, queuedAt: new Date().toISOString(), handedOver: false }],
    })));
    renderWith(<PhoneKeepsView deviceId="phone" />);
    await waitFor(() => expect(screen.getAllByTestId('phone-keeps-item')).toHaveLength(2));
    expect(screen.getAllByTestId('phone-keeps-item')[0]).toHaveTextContent('Big');
    expect(screen.getByTestId('phone-keeps-space')).toHaveTextContent('910 MB kept · 4.0 GB limit · 15.0 GB free on phone');
    expect(screen.getByTestId('phone-keeps-waiting-row')).toHaveTextContent(/Keep Next · asked/);
    fireEvent.click(screen.getAllByTestId('phone-keeps-remove')[0]);
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('api/v1/device/phone/unkeep', expect.objectContaining({ contentId: 'plex:2', installId: A }), 'POST'));
  });

  it('a gone install is shown as gone', async () => {
    apiMock.mockResolvedValue(keepsView({ installs: [{ installId: A, model: 'old phone', live: false, gone: true, lastPollAt: '2026-10-01T00:00:00.000Z' }] }));
    renderWith(<PhoneKeepsView deviceId="phone" />);
    await waitFor(() => expect(screen.getByTestId('phone-keeps-gone')).toBeVisible());
  });
});
