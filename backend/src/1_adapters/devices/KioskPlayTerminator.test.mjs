import { describe, it, expect, beforeEach } from 'vitest';
import { KioskPlayTerminator } from './KioskPlayTerminator.mjs';

const PKG = 'com.example.emulator';
const quiet = { warn() {}, error() {} };
let shelled, kioskCalls;

const adb = { shell: async (c) => { shelled.push(c); return { ok: true }; } };
const kiosk = { command: async (c) => { kioskCalls.push(c); return { ok: true }; } };
const build = (over = {}) => new KioskPlayTerminator({
  adbByDevice: new Map([['tv', adb]]),
  kioskByDevice: new Map([['tv', kiosk]]),
  packageName: PKG, logger: quiet, ...over,
});

beforeEach(() => { shelled = []; kioskCalls = []; });

describe('KioskPlayTerminator', () => {
  it('force-stops the emulator and restores the kiosk', async () => {
    expect(await build().endPlay('tv')).toEqual({ ok: true });
    expect(shelled).toEqual([`am force-stop ${PKG}`]);
    expect(kioskCalls).toEqual(['toForeground']);
  });

  it('reports failure when there is no ADB channel', async () => {
    const r = await build({ adbByDevice: new Map() }).endPlay('tv');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ADB/);
  });

  it('reports failure when the stop itself fails', async () => {
    const failing = { shell: async () => ({ ok: false, error: 'device offline' }) };
    const r = await build({ adbByDevice: new Map([['tv', failing]]) }).endPlay('tv');
    expect(r).toEqual({ ok: false, error: 'device offline' });
    expect(kioskCalls).toEqual([]);
  });

  it('still succeeds when restoring the kiosk fails — the game is already stopped', async () => {
    // Reporting failure here would invite a retry that kills nothing twice.
    const broken = { command: async () => { throw new Error('kiosk unreachable'); } };
    expect(await build({ kioskByDevice: new Map([['tv', broken]]) }).endPlay('tv')).toEqual({ ok: true });
  });

  it('requires a package name rather than guessing one', () => {
    expect(() => new KioskPlayTerminator({})).toThrow(/packageName/);
  });
});
