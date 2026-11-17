import { describe, it, expect, vi } from 'vitest';
import { DaylightAndroidArcadeKioskClient } from './DaylightAndroidArcadeKioskClient.mjs';
import { KioskArcadeGameSpeaker } from './KioskArcadeGameSpeaker.mjs';
import { RetroArchArcadeGameObservationSource } from '../RetroArchArcadeGameObservationSource.mjs';

const ok = (data = {}) => ({ ok: true, data: { ok: true, ...data } });
const quiet = { debug() {}, info() {}, warn() {}, error() {} };

function build({ get = vi.fn(async () => ok()), post = vi.fn(async () => ok()) } = {}) {
  const restClient = { get, post, delete: vi.fn() };
  return { client: new DaylightAndroidArcadeKioskClient({ restClient }), get, post };
}

describe('DaylightAndroidArcadeKioskClient', () => {
  it('requires a rest client', () => {
    expect(() => new DaylightAndroidArcadeKioskClient({})).toThrow(/restClient/);
  });

  it('deviceInfo reads what is in front from GET /lockdown', async () => {
    const { client, get } = build({
      get: vi.fn(async () => ok({ locked: true, foreground: 'com.example.emulator', allowedApps: [] })),
    });

    const result = await client.command('deviceInfo');

    expect(get).toHaveBeenCalledWith('/lockdown');
    expect(result.ok).toBe(true);
    // Both spellings: the arcade observation source reads `foregroundApp`.
    expect(result.data).toMatchObject({ foreground: 'com.example.emulator', foregroundApp: 'com.example.emulator' });
  });

  it('toForeground posts /kiosk/foreground', async () => {
    const { client, post } = build({ post: vi.fn(async () => ok({ kioskInForeground: true })) });
    const result = await client.command('toForeground');
    expect(post).toHaveBeenCalledWith('/kiosk/foreground');
    expect(result.ok).toBe(true);
  });

  it('textToSpeech posts the text to /speak', async () => {
    const { client, post } = build({ post: vi.fn(async () => ok({ queued: true })) });
    const result = await client.command('textToSpeech', { text: 'Five minutes left', locale: 'en-US' });
    expect(post).toHaveBeenCalledWith('/speak', { text: 'Five minutes left', locale: 'en-US' });
    expect(result.ok).toBe(true);
  });

  it('passes a device failure through unchanged', async () => {
    const failure = { ok: false, code: 'UNREACHABLE', error: 'connect ECONNREFUSED' };
    const { client } = build({ get: vi.fn(async () => failure), post: vi.fn(async () => failure) });
    await expect(client.command('deviceInfo')).resolves.toEqual(failure);
    await expect(client.command('toForeground')).resolves.toEqual(failure);
  });

  it.each(['setStringSetting', 'loadURL', 'rebootDevice'])(
    'answers UNSUPPORTED for %s without touching the device',
    async (command) => {
      const { client, get, post } = build();
      const result = await client.command(command, { key: 'webOverlayUrl', value: 'https://x.test/' });
      expect(result).toMatchObject({ ok: false, code: 'UNSUPPORTED' });
      expect(get).not.toHaveBeenCalled();
      expect(post).not.toHaveBeenCalled();
    },
  );

  it('says it has no web overlay', () => {
    expect(build().client.supportsWebOverlay).toBe(false);
  });

  it('drives the arcade speaker', async () => {
    const { client, post } = build({ post: vi.fn(async () => ok({ queued: true })) });
    const speaker = new KioskArcadeGameSpeaker({ clientsByDevice: new Map([['tv', client]]), logger: quiet });
    await expect(speaker.say('tv', 'Time is up')).resolves.toBe(true);
    expect(post).toHaveBeenCalledWith('/speak', { text: 'Time is up' });
  });

  it('gives the arcade observation source its foreground reading', async () => {
    const { client } = build({ get: vi.fn(async () => ok({ foreground: 'com.example.emulator' })) });
    const source = new RetroArchArcadeGameObservationSource({
      kioskClient: client, adbAdapter: null, packageName: 'com.example.emulator',
      logReader: null, resolveContent: async () => null, pollIntervalMs: 1000, logger: quiet,
    });
    // Emulator in front, no ADB to confirm play: foreground-only, from the kiosk.
    await expect(source.observe('tv')).resolves.toMatchObject({ loaded: true, channel: 'kiosk', degraded: true });
  });
});
