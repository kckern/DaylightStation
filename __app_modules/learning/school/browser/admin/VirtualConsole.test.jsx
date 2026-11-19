import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import VirtualConsole from './VirtualConsole.jsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });

it('dispatches a scan once and skips the post-scan refresh after leaving the console', async () => {
  const scan = Promise.withResolvers();
  const paths = [];
  vi.stubGlobal('fetch', vi.fn((url, options) => {
    const path = new URL(url, location.href).pathname.split('/').pop();
    paths.push([options.method, path]);
    if (path === 'scan') return scan.promise;
    return Promise.resolve(reply(path === 'status' ? { devices: { scanner: { present: true } } } : {}));
  }));
  const view = render(<VirtualConsole />);
  fireEvent.change(await screen.findByLabelText('Code'), { target: { value: 'sch:test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Scan' }));
  view.unmount();
  await act(async () => scan.resolve(reply({})));
  expect(paths).toEqual([['GET', 'status'], ['GET', 'captures'], ['GET', 'playback'], ['POST', 'scan']]);
});

it('recovers from disabled status on the next poll and keeps a rejected scan visible through refresh', async () => {
  vi.useFakeTimers();
  let wired = false;
  let scans = 0;
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    const path = new URL(url, location.href).pathname.split('/').pop();
    if (path === 'status') return wired
      ? reply({ devices: { scanner: { present: true } } })
      : reply({ error: 'Not wired' }, 404);
    if (path === 'scan') {
      scans++;
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body)).toEqual({ code: 'sch:test', device: 'virtual-console' });
      return reply({ error: 'Scanner offline', code: 'OFFLINE' }, 409);
    }
    return reply({});
  }));
  try {
    await act(async () => { render(<VirtualConsole />); });
    expect(screen.getByText('Virtual device console is off')).toBeVisible();
    wired = true;
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'sch:test' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Scan' })));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Refresh' })));
    expect(screen.getByText('scan: Scanner offline')).toBeVisible();
    expect(scans).toBe(1);
  } finally {
    vi.useRealTimers();
  }
});

it('lets a pending read finish across visible ticks and refreshes once on foreground return', async () => {
  vi.useFakeTimers();
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const heldStatus = Promise.withResolvers();
  let statusReads = 0;
  vi.stubGlobal('fetch', vi.fn(async url => {
    const path = new URL(url, location.href).pathname.split('/').pop();
    if (path !== 'status') return reply({});
    statusReads++;
    return statusReads === 1 ? heldStatus.promise : reply({ devices: {} });
  }));
  try {
    await act(async () => { render(<VirtualConsole />); });
    await act(async () => vi.advanceTimersByTimeAsync(6000));
    expect(statusReads).toBe(1);
    await act(async () => heldStatus.resolve(reply({ devices: { scanner: { present: true } } })));
    expect(screen.getByRole('button', { name: 'Scan' })).toBeVisible();

    visibility.mockReturnValue('hidden');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => vi.advanceTimersByTimeAsync(6000));
    expect(statusReads).toBe(1);

    visibility.mockReturnValue('visible');
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(statusReads).toBe(2);
  } finally {
    visibility.mockRestore();
    vi.useRealTimers();
  }
});
