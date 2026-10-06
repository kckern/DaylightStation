import { describe, it, expect, vi } from 'vitest';
import { createFleetStore } from '../fleet/fleetStore.js';
import { createAckRouter } from './ackRouter.js';
import { createRemoteSessionController } from './RemoteSessionController.js';

vi.mock('../logging/mediaLog.js', () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

function setup(extra = {}) {
  const ackRouter = createAckRouter();
  const http = vi.fn(async () => ({ ok: true }));
  let n = 0;
  const ctl = createRemoteSessionController({
    deviceId: 'tv', fleetStore: createFleetStore(), ackRouter, http, randomUuid: () => `cmd-${++n}`, ...extra,
  });
  return { ackRouter, http, ctl };
}

describe('RemoteSessionController — screen session controls (P1, additive)', () => {
  it.each([
    ['setSleepTimer', [{ minutes: 30 }], 'POST', 'sleep-timer', { minutes: 30 }],
    ['setSleepTimer', [{ atEnd: 'item' }], 'POST', 'sleep-timer', { atEnd: 'item' }],
    ['cancelSleepTimer', [], 'POST', 'sleep-timer/cancel', {}],
    ['resumeSleep', [], 'POST', 'sleep-timer/resume', {}],
    ['putBack', ['note-1'], 'POST', 'put-back', { noteId: 'note-1' }],
    ['putBack', [], 'POST', 'put-back', {}],
    ['cancelCountdown', [], 'POST', 'countdown/cancel', {}],
    ['startNextNow', [], 'POST', 'countdown/start-now', {}],
    ['setAddOnly', [true], 'PUT', 'add-only', { enabled: true }],
    ['setEndOfQueue', ['similar'], 'PUT', 'end-of-queue', { mode: 'similar' }],
    ['setStopAfterCurrent', [true], 'PUT', 'stop-after-current', { enabled: true }],
    // Player features (P2): tracks, Show briefly, music behind.
    ['setTracks', [{ subtitle: '1278358' }], 'POST', 'tracks', { subtitle: '1278358' }],
    ['setTracks', [{ audio: '7', subtitle: 'off' }], 'POST', 'tracks', { audio: '7', subtitle: 'off' }],
    ['closeBrief', [], 'POST', 'brief/close', {}],
    ['musicBehind', ['start', { contentId: 'plex:500', title: 'Album' }], 'POST', 'music-behind', { op: 'start', contentId: 'plex:500', title: 'Album' }],
    ['musicBehind', ['next'], 'POST', 'music-behind', { op: 'next' }],
  ])('%s(%j) → %s /session/%s and resolves on the device ack', async (method, args, verb, path, body) => {
    const { ackRouter, http, ctl } = setup();
    const pending = ctl.sessionControls[method](...args);
    expect(http).toHaveBeenCalledWith(`api/v1/device/tv/session/${path}`, { ...body, commandId: 'cmd-1' }, verb);
    ackRouter.resolve({ commandId: 'cmd-1', ok: true });
    await expect(pending).resolves.toMatchObject({ ok: true, commandId: 'cmd-1' });
  });

  it('attaches the caller origin to every command when given', async () => {
    const origin = { kind: 'device', id: 'browser:abc', name: "Dad's phone" };
    const { http, ctl } = setup({ origin });
    ctl.transport.pause();
    ctl.sessionControls.setAddOnly(false);
    expect(http.mock.calls[0][1]).toMatchObject({ action: 'pause', origin });
    expect(http.mock.calls[1][1]).toMatchObject({ enabled: false, origin });
  });

  it('sends no origin field when none is configured', () => {
    const { http, ctl } = setup();
    ctl.transport.pause();
    expect(http.mock.calls[0][1]).not.toHaveProperty('origin');
  });
});
