import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DaylightAndroidArcadeGameOverlay } from './DaylightAndroidArcadeGameOverlay.mjs';
import { DeviceRoutedArcadeGameOverlay } from './DeviceRoutedArcadeGameOverlay.mjs';
import { DaylightAndroidArcadeKioskClient } from './DaylightAndroidArcadeKioskClient.mjs';

let posts;
let answer;
const restClient = { get: vi.fn(), post: async (route, body) => { posts.push([route, body]); return answer(route, body); }, delete: vi.fn() };
const quiet = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
const ok200 = { get: async () => ({ status: 200 }) };
const ok = (data = {}) => ({ ok: true, data: { ok: true, ...data } });

const overlay = (over = {}) => new DaylightAndroidArcadeGameOverlay({
  clientsByDevice: new Map([['tv', new DaylightAndroidArcadeKioskClient({ restClient })]]),
  httpClient: ok200, logger: quiet, ...over,
});

beforeEach(() => {
  posts = [];
  answer = (_route, body) => ok(body.url
    ? { shown: true, kind: 'web', text: { shown: false }, web: { shown: true, url: body.url } }
    : { shown: false, kind: 'none', text: { shown: false }, web: { shown: false, url: null } });
  Object.values(quiet).forEach(fn => fn.mockClear());
});

describe('DaylightAndroidArcadeGameOverlay - only declared devices', () => {
  it('requires clientsByDevice', () => {
    expect(() => new DaylightAndroidArcadeGameOverlay({})).toThrow(/clientsByDevice/);
  });

  it('refuses to arm a device that was never declared', async () => {
    expect(await overlay().arm('art-panel', 'https://x/film.html')).toBe(false);
    expect(posts).toEqual([]);
  });

  it('disarming an undeclared device is a harmless no-op', async () => {
    expect(await overlay().disarm('art-panel')).toBe(false);
    expect(posts).toEqual([]);
  });
});

describe('DaylightAndroidArcadeGameOverlay - refuses to paint a broken page', () => {
  it('does not arm when the page does not resolve', async () => {
    const o = overlay({ httpClient: { get: async () => ({ status: 404 }) } });
    expect(await o.arm('tv', 'https://x/missing.html')).toBe(false);
    expect(posts).toEqual([]);
    expect(quiet.error).toHaveBeenCalledWith('arcade.overlay.url_unreachable', expect.objectContaining({ deviceId: 'tv' }));
  });

  it('does not arm when verifying the page throws', async () => {
    const o = overlay({ httpClient: { get: async () => { throw new Error('ECONNREFUSED'); } } });
    expect(await o.arm('tv', 'https://x/film.html')).toBe(false);
    expect(posts).toEqual([]);
  });

  it('does not arm without a URL', async () => {
    expect(await overlay().arm('tv', '')).toBe(false);
    expect(posts).toEqual([]);
  });
});

describe('DaylightAndroidArcadeGameOverlay - arm', () => {
  it('shows the page as a web overlay at the bottom by default', async () => {
    expect(await overlay().arm('tv', 'https://x/film.html')).toBe(true);
    expect(posts).toEqual([['/kiosk/overlay', { url: 'https://x/film.html', gravity: 'bottom' }]]);
    expect(quiet.info).toHaveBeenCalledWith('arcade.overlay.armed', {
      deviceId: 'tv', ok: true, url: 'https://x/film.html', gravity: 'bottom', error: undefined,
    });
  });

  it('passes a configured gravity', async () => {
    await overlay({ gravity: 'top' }).arm('tv', 'https://x/film.html');
    expect(posts[0][1].gravity).toBe('top');
  });

  it('rejects a gravity the device does not have', () => {
    expect(() => overlay({ gravity: 80 })).toThrow(/gravity/);
  });

  it('reports failure when the device refuses', async () => {
    answer = () => ({ ok: false, code: 'UNREACHABLE', error: 'connect ECONNREFUSED' });
    expect(await overlay().arm('tv', 'https://x/film.html')).toBe(false);
    expect(quiet.warn).toHaveBeenCalledWith('arcade.overlay.armed', expect.objectContaining({
      deviceId: 'tv', ok: false, error: 'connect ECONNREFUSED',
    }));
  });

  it('is armed when the web layer is showing, whatever the text layer is doing', async () => {
    // An operator message is up as well; the summary `kind` may name it.
    answer = () => ok({ shown: true, kind: 'text', text: { shown: true }, web: { shown: true, url: 'https://x/film.html' } });
    expect(await overlay().arm('tv', 'https://x/film.html')).toBe(true);
  });

  it('is not armed when the web layer is not showing, even though a text message is', async () => {
    answer = () => ok({ shown: true, kind: 'web', text: { shown: true }, web: { shown: false, url: null } });
    expect(await overlay().arm('tv', 'https://x/film.html')).toBe(false);
  });

  it('falls back to `kind` only when the answer has no web layer field', async () => {
    answer = () => ok({ shown: true, kind: 'web' });
    expect(await overlay().arm('tv', 'https://x/film.html')).toBe(true);
    answer = () => ok({ shown: true, kind: 'text' });
    expect(await overlay().arm('tv', 'https://x/film.html')).toBe(false);
    answer = () => ok({ shown: false, kind: 'none' });
    expect(await overlay().arm('tv', 'https://x/film.html')).toBe(false);
  });
});

describe('DaylightAndroidArcadeGameOverlay - teardown', () => {
  it('clears the web overlay only, leaving an operator text message alone', async () => {
    expect(await overlay().disarm('tv')).toBe(true);
    expect(posts).toEqual([['/kiosk/overlay', { url: '' }]]);
    expect(quiet.info).toHaveBeenCalledWith('arcade.overlay.disarmed', { deviceId: 'tv', ok: true, error: undefined });
  });

  it('reports failure when the device rejects the clear', async () => {
    answer = () => ({ ok: false, code: 'UNREACHABLE', error: 'connect ECONNREFUSED' });
    expect(await overlay().disarm('tv')).toBe(false);
  });
});

describe('DeviceRoutedArcadeGameOverlay', () => {
  const fake = () => ({ arm: vi.fn(async () => true), disarm: vi.fn(async () => true) });

  it('sends each device to the overlay registered for it', async () => {
    const fully = fake();
    const daylight = fake();
    const routed = new DeviceRoutedArcadeGameOverlay({ overlayByDevice: new Map([['den-tv', fully], ['tv', daylight]]) });

    expect(await routed.arm('tv', 'https://x/film.html')).toBe(true);
    expect(await routed.disarm('den-tv')).toBe(true);

    expect(daylight.arm).toHaveBeenCalledWith('tv', 'https://x/film.html');
    expect(fully.disarm).toHaveBeenCalledWith('den-tv');
    expect(fully.arm).not.toHaveBeenCalled();
    expect(daylight.disarm).not.toHaveBeenCalled();
  });

  it('does nothing for a device with no overlay', async () => {
    const routed = new DeviceRoutedArcadeGameOverlay({ overlayByDevice: new Map() });
    expect(await routed.arm('art-panel', 'https://x/film.html')).toBe(false);
    expect(await routed.disarm('art-panel')).toBe(false);
  });
});
