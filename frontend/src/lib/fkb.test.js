import { describe, it, expect, afterEach, vi } from 'vitest';
import { launchIntent } from './fkb.js';

const PKG = 'com.retroarch.aarch64';
const ACT = 'com.retroarch.browser.retroactivity.RetroActivityFuture';

/** Install a mock FKB bridge and return the startIntent spy. */
function mockBridge() {
  const startIntent = vi.fn();
  global.fully = { startIntent };
  return startIntent;
}

describe('fkb launchIntent', () => {
  afterEach(() => {
    delete global.fully;
    vi.restoreAllMocks();
  });

  it('encodes ROM paths containing spaces, parens and brackets', () => {
    const startIntent = mockBridge();
    const rom = '/storage/emulated/0/Games/GB/Super Mario Land (JUE) (V1.1) [!].gb';

    expect(launchIntent(PKG, ACT, { ROM: rom })).toBe(true);

    const uri = startIntent.mock.calls[0][0];
    expect(uri).not.toMatch(/ /);
    expect(uri).not.toMatch(/[[\]]/);
    expect(uri.endsWith(';end')).toBe(true);
    // The path must still be recoverable by the receiver.
    const encoded = uri.match(/S\.ROM=([^;]*);/)[1];
    expect(decodeURIComponent(encoded)).toBe(rom);
  });

  it('does not let a value inject an additional intent field', () => {
    const startIntent = mockBridge();

    launchIntent(PKG, ACT, { ROM: 'a;S.EVIL=1' });

    const uri = startIntent.mock.calls[0][0];
    expect(uri).not.toMatch(/;S\.EVIL=1;/);
    // Exactly one extra field survives, and it round-trips to the raw value.
    const fields = uri.match(/S\.[^;]*;/g);
    expect(fields).toHaveLength(1);
    expect(decodeURIComponent(fields[0].match(/S\.ROM=([^;]*);/)[1])).toBe('a;S.EVIL=1');
  });

  it('encodes keys as well as values', () => {
    const startIntent = mockBridge();

    launchIntent(PKG, ACT, { 'BAD;KEY': 'x' });

    const uri = startIntent.mock.calls[0][0];
    expect(uri).not.toMatch(/S\.BAD;KEY=/);
    expect(uri).toMatch(/S\.BAD%3BKEY=x;/);
  });

  it('leaves the component untouched — dots and slash are structural', () => {
    const startIntent = mockBridge();

    launchIntent(PKG, ACT, { ROM: '/a b.gb' });

    const uri = startIntent.mock.calls[0][0];
    expect(uri.startsWith(`intent:#Intent;component=${PKG}/${ACT};`)).toBe(true);
  });

  it('builds a well-formed URI for multiple extras', () => {
    const startIntent = mockBridge();

    launchIntent(PKG, ACT, {
      ROM: '/storage/emulated/0/Games/GB/Pokemon - Yellow Version (USA, Europe).gbc',
      LIBRETRO: '/data/data/com.retroarch.aarch64/cores/gambatte_libretro_android.so',
      CONFIGFILE: '/storage/emulated/0/RetroArch/retroarch.cfg',
    });

    const uri = startIntent.mock.calls[0][0];
    expect(uri).not.toMatch(/ /);
    expect(uri.match(/S\.[^;]*;/g)).toHaveLength(3);
    expect(uri.endsWith(';end')).toBe(true);
  });

  it('returns false without throwing when the bridge is absent', () => {
    expect(typeof global.fully).toBe('undefined');
    expect(() => launchIntent(PKG, ACT, { ROM: '/a.gb' })).not.toThrow();
    expect(launchIntent(PKG, ACT, { ROM: '/a.gb' })).toBe(false);
  });

  it('returns false when fully lacks startIntent', () => {
    global.fully = {};
    expect(launchIntent(PKG, ACT, { ROM: '/a.gb' })).toBe(false);
  });

  it('returns true and calls startIntent exactly once when present', () => {
    const startIntent = mockBridge();
    expect(launchIntent(PKG, ACT, {})).toBe(true);
    expect(startIntent).toHaveBeenCalledTimes(1);
    expect(startIntent.mock.calls[0][0]).toBe(`intent:#Intent;component=${PKG}/${ACT};end`);
  });
});
