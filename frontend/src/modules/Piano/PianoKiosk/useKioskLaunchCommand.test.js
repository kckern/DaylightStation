import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shared spies, hoisted so the vi.mock factories can close over them.
const h = vi.hoisted(() => ({
  DaylightAPI: vi.fn(),
  launchIntent: vi.fn(() => true),
  send: vi.fn(),
  handlers: [],
}));

vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: h.DaylightAPI }));
vi.mock('../../../lib/fkb.js', () => ({ launchIntent: h.launchIntent }));
vi.mock('../../../services/WebSocketService.js', () => ({ wsService: { send: h.send } }));
// Capture the subscriber so tests can push messages at it directly.
vi.mock('../../../hooks/useWebSocket.js', () => ({
  useWebSocketSubscription: (_topic, cb) => { h.handlers[0] = cb; },
}));
vi.mock('./kioskDeviceIdentity.js', () => ({ KIOSK_DEVICE_ID: 'yellow-room-tablet' }));

import { useKioskLaunchCommand } from './useKioskLaunchCommand.js';

const TARGET = 'com.retroarch.aarch64/com.retroarch.browser.retroactivity.RetroActivityFuture';
const PARAMS = { ROM: '/storage/emulated/0/Games/GB/Super Mario Land.gb', LIBRETRO: '/tmp/gambatte.so' };
const CONTENT = 'retroarch:gb/super-mario-land';

const deliver = (msg) => h.handlers[0](msg);
const mount = (opts) => renderHook(() => useKioskLaunchCommand(opts));

// The hook makes two different calls through DaylightAPI: the allowlist and the
// intent. Route by path so tests can vary either independently.
const routeApi = ({ allow = [CONTENT], intent = { target: TARGET, params: PARAMS } } = {}) => {
  h.DaylightAPI.mockImplementation((path) => {
    if (String(path).includes('launch-targets')) {
      return Promise.resolve({ targets: [{ deviceId: 'yellow-room-tablet', allow }] });
    }
    if (intent instanceof Error) return Promise.reject(intent);
    return Promise.resolve(intent);
  });
};

describe('useKioskLaunchCommand', () => {
  beforeEach(() => {
    h.DaylightAPI.mockReset();
    routeApi();
    h.launchIntent.mockReset().mockReturnValue(true);
    h.send.mockReset();
    h.handlers.length = 0;
  });

  it('launches a game addressed to this device', async () => {
    mount();
    await deliver({ deviceId: 'yellow-room-tablet', contentId: CONTENT });

    await waitFor(() => expect(h.launchIntent).toHaveBeenCalledTimes(1));
    expect(h.launchIntent).toHaveBeenCalledWith(
      'com.retroarch.aarch64',
      'com.retroarch.browser.retroactivity.RetroActivityFuture',
      PARAMS
    );
  });

  it('ignores a launch addressed to a different device', async () => {
    // Every kiosk sees every relayed message, so this guard is what stops one
    // parent click from launching on all of them.
    mount();
    await deliver({ deviceId: 'livingroom-tv', contentId: CONTENT });

    expect(h.DaylightAPI).not.toHaveBeenCalled();
    expect(h.launchIntent).not.toHaveBeenCalled();
  });

  it('ignores a message with no contentId', async () => {
    mount();
    await deliver({ deviceId: 'yellow-room-tablet' });
    expect(h.launchIntent).not.toHaveBeenCalled();
  });

  it('is inert when disabled', async () => {
    mount({ enabled: false });
    await deliver({ deviceId: 'yellow-room-tablet', contentId: CONTENT });
    expect(h.launchIntent).not.toHaveBeenCalled();
  });

  it('does nothing when this client has no device identity', async () => {
    // A laptop dev tab pointed at /piano has no ?device= — it must never launch.
    mount({ deviceId: null });
    await deliver({ deviceId: 'yellow-room-tablet', contentId: CONTENT });
    expect(h.launchIntent).not.toHaveBeenCalled();
  });

  it('refuses a contentId outside the allowlist', async () => {
    // The save-divergence guard: an unlisted title must not boot here.
    mount();
    await deliver({ deviceId: 'yellow-room-tablet', contentId: 'retroarch:gb/pokemon-red' });

    expect(h.launchIntent).not.toHaveBeenCalled();
    await waitFor(() => expect(h.send).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: 'not_allowed', contentId: 'retroarch:gb/pokemon-red' })
    ));
  });

  it('allows a contentId on the allowlist', async () => {
    mount();
    await deliver({ deviceId: 'yellow-room-tablet', contentId: CONTENT });
    await waitFor(() => expect(h.launchIntent).toHaveBeenCalledTimes(1));
  });

  it('refuses when the allowlist cannot be fetched', async () => {
    // Fail closed: not knowing what is permitted must not mean permitting
    // everything — a wrong launch creates an unreconcilable second save.
    h.DaylightAPI.mockRejectedValue(new Error('offline'));
    mount();
    await deliver({ deviceId: 'yellow-room-tablet', contentId: CONTENT });

    expect(h.launchIntent).not.toHaveBeenCalled();
    await waitFor(() => expect(h.send).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: 'not_allowed' })
    ));
  });

  it('refuses when this device has no configured target', async () => {
    h.DaylightAPI.mockImplementation((path) => (
      String(path).includes('launch-targets')
        ? Promise.resolve({ targets: [{ deviceId: 'some-other-device', allow: [CONTENT] }] })
        : Promise.resolve({ target: TARGET, params: PARAMS })
    ));
    mount();
    await deliver({ deviceId: 'yellow-room-tablet', contentId: CONTENT });

    expect(h.launchIntent).not.toHaveBeenCalled();
    await waitFor(() => expect(h.send).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: 'not_allowed' })
    ));
  });

  it('refuses when the device target has an empty allowlist', async () => {
    routeApi({ allow: [] });
    mount();
    await deliver({ deviceId: 'yellow-room-tablet', contentId: CONTENT });

    expect(h.launchIntent).not.toHaveBeenCalled();
  });

  it('publishes a success result', async () => {
    mount();
    await deliver({ deviceId: 'yellow-room-tablet', contentId: CONTENT });

    await waitFor(() => expect(h.send).toHaveBeenCalledWith({
      topic: 'kiosk.launch.result',
      deviceId: 'yellow-room-tablet',
      contentId: CONTENT,
      ok: true,
    }));
  });

  it('reports a failed intent resolve instead of launching', async () => {
    routeApi({ intent: new Error('boom') });
    mount();
    await deliver({ deviceId: 'yellow-room-tablet', contentId: CONTENT });

    expect(h.launchIntent).not.toHaveBeenCalled();
    await waitFor(() => expect(h.send).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: 'intent_resolve_failed' })
    ));
  });

  it('reports a malformed target instead of launching', async () => {
    routeApi({ intent: { target: 'no-slash-here', params: {} } });
    mount();
    await deliver({ deviceId: 'yellow-room-tablet', contentId: CONTENT });

    expect(h.launchIntent).not.toHaveBeenCalled();
    await waitFor(() => expect(h.send).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: 'target_malformed' })
    ));
  });

  it('reports when FKB is unavailable', async () => {
    h.launchIntent.mockReturnValue(false);
    mount();
    await deliver({ deviceId: 'yellow-room-tablet', contentId: CONTENT });

    await waitFor(() => expect(h.send).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: 'fkb_unavailable' })
    ));
  });
});
