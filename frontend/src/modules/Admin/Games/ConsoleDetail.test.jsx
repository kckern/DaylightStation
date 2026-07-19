import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const h = vi.hoisted(() => ({
  send: vi.fn(),
  resultHandlers: [],
  targets: [],
  targetsLoading: false,
}));

vi.mock('react-router-dom', () => ({ useParams: () => ({ consoleId: 'gb' }) }));
vi.mock('../../../hooks/useWebSocket.js', () => ({
  useWebSocketSend: () => h.send,
  useWebSocketSubscription: (_topic, cb) => { h.resultHandlers[0] = cb; },
}));
vi.mock('./useKioskLaunchTargets.js', () => ({
  useKioskLaunchTargets: () => ({ targets: h.targets, loading: h.targetsLoading, error: null }),
}));

import ConsoleDetail from './ConsoleDetail.jsx';

const ALLOWED = 'retroarch:gb/super-mario-land';
const EXCLUDED = 'retroarch:gb/pokemon-red';

const GAMES = [
  { id: ALLOWED, title: 'Super Mario Land', metadata: { parentTitle: 'Game Boy' } },
  { id: EXCLUDED, title: 'Pokemon Red', metadata: { parentTitle: 'Game Boy' } },
];

const wrap = (ui) => render(<MantineProvider>{ui}</MantineProvider>);

beforeEach(() => {
  h.send.mockReset();
  h.resultHandlers.length = 0;
  h.targets = [{ deviceId: 'yellow-room-tablet', label: 'Piano Tablet', allow: [ALLOWED] }];
  h.targetsLoading = false;
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ items: GAMES }) }));
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
    // Pokemon Red has a live save on another device — offering it here is the
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

  it('explains itself when no launch targets are configured', async () => {
    h.targets = [];
    wrap(<ConsoleDetail />);
    expect(await screen.findByText(/No launch targets configured/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Launch' })).not.toBeInTheDocument();
  });
});
