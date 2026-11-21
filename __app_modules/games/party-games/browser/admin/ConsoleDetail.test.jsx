import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const h = vi.hoisted(() => ({
  send: vi.fn(),
  resultHandlers: [],
}));

vi.mock('react-router-dom', () => ({ useParams: () => ({ consoleId: 'gb' }) }));
vi.mock("../../../../../frontend/src/hooks/useWebSocket.js", () => ({

  useWebSocketSubscription: (_topic, cb) => { h.resultHandlers[0] = cb; },
}));
vi.mock("../../../../../frontend/src/services/WebSocketService.js", () => ({ wsService: { sendEphemeral: h.send } }));

import ConsoleDetail from "./ConsoleDetail.jsx";

const ALLOWED = 'retroarch:gb/super-mario-land';
const EXCLUDED = 'retroarch:gb/example-quest';

const GAMES = [
  { id: ALLOWED, title: 'Super Mario Land', metadata: { parentTitle: 'Game Boy' } },
  { id: EXCLUDED, title: 'Example Quest', metadata: { parentTitle: 'Game Boy' } },
];

const ROSTER_PATH = '/api/v1/content/launch-targets/retroarch';
const GAMES_PATH = '/api/v1/list/retroarch:gb';
const DEVICE_CONFIG_PATH = '/api/v1/device/config';
const ROSTER = { targets: [{ deviceId: 'yellow-room-tablet', allow: [ALLOWED] }] };
const DEVICE_CONFIG = { devices: { 'yellow-room-tablet': { name: 'Piano Tablet' } } };
const ok = (data) => ({ ok: true, json: async () => data });

const mockFetch = (loadRoster) => {
  global.fetch = vi.fn(async (url) => {
    switch (new URL(url, window.location.origin).pathname) {
      case ROSTER_PATH: return loadRoster();
      case GAMES_PATH: return ok({ items: GAMES });
      case DEVICE_CONFIG_PATH: return ok(DEVICE_CONFIG);
      default: throw new Error(`Unexpected request: ${url}`);
    }
  });
};

const wrap = (ui) => render(<MantineProvider>{ui}</MantineProvider>);

beforeEach(() => {
  h.send.mockReset().mockReturnValue(true);
  h.resultHandlers.length = 0;
  mockFetch(() => ok(ROSTER));
});

describe('ConsoleDetail launch controls', () => {
  it('publishes a launch command for an allowed title', async () => {
    wrap(<ConsoleDetail />);
    const button = await screen.findByRole('button', { name: 'Launch' });
    fireEvent.click(button);

    expect(h.send).toHaveBeenCalledWith({
      topic: 'kiosk.launch',
      deviceId: 'yellow-room-tablet',
      contentId: ALLOWED,
    });
  });

  it('disables titles outside the device allowlist', async () => {
    // Example Quest has a live save on another device — offering it here is the
    // exact mistake the allowlist exists to prevent.
    wrap(<ConsoleDetail />);
    const excluded = await screen.findByRole('button', { name: 'Not on device' });
    expect(excluded).toBeDisabled();

    fireEvent.click(excluded);
    expect(h.send).not.toHaveBeenCalled();
  });

  it('reports how many titles the device carries', async () => {
    wrap(<ConsoleDetail />);
    expect(await screen.findByText(/1 of 2 titles available on Piano Tablet/)).toBeInTheDocument();
  });

  it('surfaces a failure result from the device', async () => {
    wrap(<ConsoleDetail />);
    fireEvent.click(await screen.findByRole('button', { name: 'Launch' }));

    h.resultHandlers[0]({ deviceId: 'yellow-room-tablet', contentId: ALLOWED, ok: false, error: 'fkb_unavailable' });
    expect(await screen.findByText(/not running the kiosk browser/)).toBeInTheDocument();
  });

  it('surfaces a success result', async () => {
    wrap(<ConsoleDetail />);
    fireEvent.click(await screen.findByRole('button', { name: 'Launch' }));

    h.resultHandlers[0]({ deviceId: 'yellow-room-tablet', contentId: ALLOWED, ok: true });
    expect(await screen.findByText('Launched.')).toBeInTheDocument();
  });

  it('ignores a result addressed to a different device', async () => {
    wrap(<ConsoleDetail />);
    fireEvent.click(await screen.findByRole('button', { name: 'Launch' }));

    h.resultHandlers[0]({ deviceId: 'livingroom-tv', contentId: ALLOWED, ok: true });
    await waitFor(() => expect(screen.queryByText('Launched.')).not.toBeInTheDocument());
  });

  it('ignores another title and expires an unconfirmed launch', async () => {
    wrap(<ConsoleDetail />);
    const button = await screen.findByRole('button', { name: 'Launch' });
    vi.useFakeTimers();
    try {
      fireEvent.click(button);
      act(() => h.resultHandlers[0]({ deviceId: 'yellow-room-tablet', contentId: EXCLUDED, ok: true }));
      expect(screen.queryByText('Launched.')).not.toBeInTheDocument();
      expect(button).toBeDisabled();
      act(() => vi.advanceTimersByTime(30_000));
      expect(screen.getByText(/did not confirm/i)).toBeInTheDocument();
      expect(button).toBeEnabled();
    } finally { vi.useRealTimers(); }
  });

  it('reports an unavailable connection immediately without queuing a later launch', async () => {
    h.send.mockReturnValue(false);
    wrap(<ConsoleDetail />);
    const button = await screen.findByRole('button', { name: 'Launch' });
    fireEvent.click(button);
    expect(screen.getByText(/connection unavailable/i)).toBeInTheDocument();
    expect(button).toBeEnabled();
  });

  it('keeps the console browsable and retries only the failed launch target roster', async () => {
    let completeRetry;
    const retryResponse = new Promise(resolve => { completeRetry = resolve; });
    const loadRoster = vi.fn()
      .mockReturnValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error', text: async () => '' })
      .mockReturnValueOnce(retryResponse);
    mockFetch(loadRoster);
    wrap(<ConsoleDetail />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Launch targets failed to load');
    expect(alert).toHaveTextContent('HTTP 500: Internal Server Error');
    expect(screen.getByText('Game Boy')).toBeInTheDocument();
    expect(screen.getByText('Super Mario Land')).toBeInTheDocument();
    expect(screen.queryByText(/No launch targets configured/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Launch' })).not.toBeInTheDocument();

    global.fetch.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByText('Super Mario Land')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/No launch targets configured/)).not.toBeInTheDocument();
    completeRetry(ok(ROSTER));

    expect(await screen.findByRole('button', { name: 'Launch' })).toBeEnabled();
    expect(global.fetch.mock.calls.map(([url]) => new URL(url, window.location.origin).pathname))
      .toEqual([ROSTER_PATH]);
  });

  it('explains itself when no launch targets are configured', async () => {
    mockFetch(() => ok({ targets: [] }));
    wrap(<ConsoleDetail />);
    expect(await screen.findByText(/No launch targets configured/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Launch' })).not.toBeInTheDocument();
  });
});
