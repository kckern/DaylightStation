import { describe, it, expect, afterEach, vi } from 'vitest';
import { launchIntent, launchAndroidTarget } from './fkb.js';

const PKG = 'com.retroarch.aarch64';
const ACT = 'com.retroarch.browser.retroactivity.RetroActivityFuture';
const HEAD = `intent:#Intent;component=${PKG}/${ACT};`;

/** Install a mock FKB bridge and return its spies. */
function mockBridge() {
  const startIntent = vi.fn();
  const startApplication = vi.fn();
  global.fully = { startIntent, startApplication };
  return { startIntent, startApplication };
}

describe('fkb launchIntent', () => {
  afterEach(() => {
    delete global.fully;
    vi.restoreAllMocks();
  });

  it('encodes ROM paths containing spaces, parens and brackets', () => {
    const { startIntent } = mockBridge();
    const rom = '/storage/emulated/0/Games/GB/Super Mario Land (JUE) (V1.1) [!].gb';

    expect(launchIntent(PKG, ACT, { ROM: rom })).toBe(true);

    const uri = startIntent.mock.calls[0][0];
    expect(uri).toBe(
      `${HEAD}S.ROM=%2Fstorage%2Femulated%2F0%2FGames%2FGB%2FSuper%20Mario%20Land%20(JUE)%20(V1.1)%20%5B!%5D.gb;end`
    );
    expect(uri).not.toMatch(/ /);
    expect(decodeURIComponent(uri.match(/S\.ROM=([^;]*);/)[1])).toBe(rom);
  });

  // Percent-encoding, not form-encoding. AOSP's Intent.parseUri decodes with
  // Uri.decode, which does NOT map '+' to a space — so a space must go out as
  // %20 and a literal '+' must survive as %2B. URLSearchParams would break both.
  it('encodes a space as %20, never as +', () => {
    const { startIntent } = mockBridge();
    launchIntent(PKG, ACT, { ROM: '/a b.gb' });
    const uri = startIntent.mock.calls[0][0];
    expect(uri).toContain('S.ROM=%2Fa%20b.gb;');
    expect(uri).not.toContain('+');
  });

  it('encodes a literal + in a filename as %2B', () => {
    const { startIntent } = mockBridge();
    launchIntent(PKG, ACT, { ROM: 'Rock+Roll.gb' });
    expect(startIntent.mock.calls[0][0]).toBe(`${HEAD}S.ROM=Rock%2BRoll.gb;end`);
  });

  it('encodes non-ASCII filenames as UTF-8 percent escapes', () => {
    const { startIntent } = mockBridge();
    launchIntent(PKG, ACT, { ROM: 'Pokémon.gb' });
    expect(startIntent.mock.calls[0][0]).toBe(`${HEAD}S.ROM=Pok%C3%A9mon.gb;end`);
  });

  it('does not let a value inject an additional intent field', () => {
    const { startIntent } = mockBridge();

    launchIntent(PKG, ACT, { ROM: 'a;S.EVIL=1' });

    expect(startIntent.mock.calls[0][0]).toBe(`${HEAD}S.ROM=a%3BS.EVIL%3D1;end`);
  });

  it('encodes keys as well as values', () => {
    const { startIntent } = mockBridge();
    launchIntent(PKG, ACT, { 'BAD;KEY': 'x' });
    expect(startIntent.mock.calls[0][0]).toBe(`${HEAD}S.BAD%3BKEY=x;end`);
  });

  it('does not let the component inject an intent field', () => {
    const { startIntent } = mockBridge();

    launchIntent('com.evil;S.EVIL=1', ACT, {});
    expect(startIntent.mock.calls[0][0]).not.toMatch(/;S\.EVIL=1;/);

    launchIntent(PKG, 'Act;S.EVIL=1', {});
    expect(startIntent.mock.calls[1][0]).not.toMatch(/;S\.EVIL=1;/);
  });

  it('keeps the component usable: dots raw, / separator literal', () => {
    const { startIntent } = mockBridge();
    launchIntent(PKG, ACT, {});
    expect(startIntent.mock.calls[0][0]).toBe(`${HEAD}end`);
  });

  it('builds a well-formed URI for multiple extras', () => {
    const { startIntent } = mockBridge();

    launchIntent(PKG, ACT, {
      ROM: '/storage/emulated/0/Games/GB/Pokemon - Yellow Version (USA, Europe).gbc',
      LIBRETRO: '/data/data/com.retroarch.aarch64/cores/gambatte_libretro_android.so',
      CONFIGFILE: '/storage/emulated/0/RetroArch/retroarch.cfg',
    });

    expect(startIntent.mock.calls[0][0]).toBe(
      `${HEAD}` +
        'S.ROM=%2Fstorage%2Femulated%2F0%2FGames%2FGB%2FPokemon%20-%20Yellow%20Version%20(USA%2C%20Europe).gbc;' +
        'S.LIBRETRO=%2Fdata%2Fdata%2Fcom.retroarch.aarch64%2Fcores%2Fgambatte_libretro_android.so;' +
        'S.CONFIGFILE=%2Fstorage%2Femulated%2F0%2FRetroArch%2Fretroarch.cfg;' +
        'end'
    );
  });

  it('accepts a filename with & that the ADB path would reject', () => {
    const { startIntent } = mockBridge();
    launchIntent(PKG, ACT, { ROM: 'Tom & Jerry (USA).gb' });
    expect(startIntent.mock.calls[0][0]).toBe(`${HEAD}S.ROM=Tom%20%26%20Jerry%20(USA).gb;end`);
  });

  it('defaults extras to an empty object when omitted', () => {
    const { startIntent } = mockBridge();
    expect(launchIntent(PKG, ACT)).toBe(true);
    expect(startIntent).toHaveBeenCalledWith(`${HEAD}end`);
  });

  it('returns false instead of throwing on an unencodable lone surrogate', () => {
    const { startIntent } = mockBridge();
    expect(() => launchIntent(PKG, ACT, { ROM: '\uD800.gb' })).not.toThrow();
    expect(launchIntent(PKG, ACT, { ROM: '\uD800.gb' })).toBe(false);
    expect(startIntent).not.toHaveBeenCalled();
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
    const { startIntent } = mockBridge();
    expect(launchIntent(PKG, ACT, {})).toBe(true);
    expect(startIntent).toHaveBeenCalledTimes(1);
  });
});

describe('fkb launchAndroidTarget', () => {
  afterEach(() => {
    delete global.fully;
    vi.restoreAllMocks();
  });

  it('encodes the action so it cannot inject intent structure', () => {
    const { startIntent } = mockBridge();
    launchAndroidTarget({ action: 'android.settings.BLUETOOTH_SETTINGS;S.EVIL=1' });
    expect(startIntent.mock.calls[0][0]).toBe(
      'intent:#Intent;action=android.settings.BLUETOOTH_SETTINGS%3BS.EVIL%3D1;end'
    );
  });

  it('leaves a well-formed action intact', () => {
    const { startIntent } = mockBridge();
    expect(launchAndroidTarget({ action: 'android.settings.BLUETOOTH_SETTINGS' })).toBe(true);
    expect(startIntent).toHaveBeenCalledWith(
      'intent:#Intent;action=android.settings.BLUETOOTH_SETTINGS;end'
    );
  });

  it('encodes each half of a component, keeping the / separator literal', () => {
    const { startIntent } = mockBridge();
    launchAndroidTarget({
      package: 'com.android.settings',
      activity: 'com.android.settings.Settings$BluetoothSettingsActivity',
    });
    expect(startIntent.mock.calls[0][0]).toBe(
      'intent:#Intent;component=com.android.settings/com.android.settings.Settings%24BluetoothSettingsActivity;end'
    );
  });

  it('does not let a component field inject intent structure', () => {
    const { startIntent } = mockBridge();
    launchAndroidTarget({ package: 'com.evil;S.EVIL=1', activity: '.Main' });
    expect(startIntent.mock.calls[0][0]).not.toMatch(/;S\.EVIL=1;/);
  });

  it('returns false instead of throwing on an unencodable action', () => {
    const { startIntent } = mockBridge();
    expect(() => launchAndroidTarget({ action: '\uD800' })).not.toThrow();
    expect(launchAndroidTarget({ action: '\uD800' })).toBe(false);
    expect(startIntent).not.toHaveBeenCalled();
  });

  it('passes a package-only target to startApplication unencoded (not a URI)', () => {
    const { startApplication } = mockBridge();
    expect(launchAndroidTarget({ package: 'com.android.settings' })).toBe(true);
    expect(startApplication).toHaveBeenCalledWith('com.android.settings');
  });

  it('returns false for an empty target and when the bridge is absent', () => {
    mockBridge();
    expect(launchAndroidTarget({})).toBe(false);
    delete global.fully;
    expect(launchAndroidTarget({ action: 'x' })).toBe(false);
  });
});
