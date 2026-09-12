import { describe, it, expect, beforeEach } from 'vitest';
import { FullyKioskPlayOverlay } from './FullyKioskPlayOverlay.mjs';

let sent;
const client = { command: async (cmd, params) => { sent.push([cmd, params]); return { ok: true }; } };
const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const ok200 = { get: async () => ({ status: 200 }) };

const overlay = (over = {}) => new FullyKioskPlayOverlay({
  clientsByDevice: new Map([['tv', client]]), httpClient: ok200, logger: quiet, ...over,
});

beforeEach(() => { sent = []; });

describe('FullyKioskPlayOverlay — only declared devices', () => {
  it('refuses to arm a device that was never declared', async () => {
    expect(await overlay().arm('art-panel', 'https://x/film.html')).toBe(false);
    expect(sent).toEqual([]);
  });

  it('disarming an undeclared device is a harmless no-op', async () => {
    expect(await overlay().disarm('art-panel')).toBe(false);
    expect(sent).toEqual([]);
  });
});

describe('FullyKioskPlayOverlay — refuses to paint a broken page', () => {
  it('does not arm when the page does not resolve', async () => {
    const o = overlay({ httpClient: { get: async () => ({ status: 404 }) } });
    expect(await o.arm('tv', 'https://x/missing.html')).toBe(false);
    // Nothing was written to the device — a 404 would render a browser error
    // page over the television.
    expect(sent).toEqual([]);
  });

  it('does not arm when verifying the page throws', async () => {
    const o = overlay({ httpClient: { get: async () => { throw new Error('ECONNREFUSED'); } } });
    expect(await o.arm('tv', 'https://x/film.html')).toBe(false);
    expect(sent).toEqual([]);
  });

  it('arms when the page resolves', async () => {
    expect(await overlay().arm('tv', 'https://x/film.html')).toBe(true);
    expect(sent.map((s) => s[1].key)).toEqual(['webOverlayGravity', 'webOverlayUrl']);
    expect(sent[1][1].value).toBe('https://x/film.html');
  });

  it('sets a real gravity, since the default leaves the overlay unplaced', async () => {
    await overlay({ gravity: 80 }).arm('tv', 'https://x/film.html');
    expect(sent[0][1].value).toBe('80');
  });
});

describe('FullyKioskPlayOverlay — teardown', () => {
  it('clears the overlay URL', async () => {
    expect(await overlay().disarm('tv')).toBe(true);
    expect(sent).toEqual([['setStringSetting', { key: 'webOverlayUrl', value: '' }]]);
  });

  it('reports failure when the device rejects the write', async () => {
    const failing = { command: async () => ({ ok: false, code: 'UNREACHABLE' }) };
    const o = overlay({ clientsByDevice: new Map([['tv', failing]]) });
    expect(await o.disarm('tv')).toBe(false);
  });
});
