import { describe, it, expect } from 'vitest';
import { buildIntentUri } from './fkb.js';

const PKG = 'com.retroarch.aarch64';
const ACT = 'com.retroarch.browser.retroactivity.RetroActivityFuture';

describe('buildIntentUri', () => {
  it('builds a component intent with no extras', () => {
    expect(buildIntentUri(PKG, ACT)).toBe(`intent:#Intent;component=${PKG}/${ACT};end`);
  });

  it('encodes spaces in ROM paths', () => {
    // Every title on the tablet has spaces; a raw space breaks Uri.decode.
    const uri = buildIntentUri(PKG, ACT, { ROM: '/storage/emulated/0/Games/GB/Super Mario Land.gb' });
    expect(uri).toContain('S.ROM=%2Fstorage%2Femulated%2F0%2FGames%2FGB%2FSuper%20Mario%20Land.gb');
    expect(uri).not.toContain('Super Mario Land');
  });

  it('encodes brackets and parentheses in ROM filenames', () => {
    const uri = buildIntentUri(PKG, ACT, { ROM: 'Super Mario Land (JUE) (V1.1) [!].gb' });
    expect(uri).toContain('%5B');   // [
    expect(uri).toContain('%5D');   // ]
  });

  it('encodes a semicolon so a path cannot terminate the field', () => {
    // The injection case: a raw ';' would end S.ROM and start a new intent field.
    const uri = buildIntentUri(PKG, ACT, { ROM: '/roms/evil;S.LIBRETRO=/tmp/pwn.so' });
    expect(uri).toContain('%3B');
    expect(uri.match(/S\.LIBRETRO=/g)).toBeNull();
  });

  it('keeps multiple extras separate and terminates with end', () => {
    const uri = buildIntentUri(PKG, ACT, { ROM: '/a.gb', LIBRETRO: '/b.so' });
    expect(uri).toBe(`intent:#Intent;component=${PKG}/${ACT};S.ROM=%2Fa.gb;S.LIBRETRO=%2Fb.so;end`);
  });

  it('rejects an extra key containing an intent separator', () => {
    expect(() => buildIntentUri(PKG, ACT, { 'ROM;S.X': '/a.gb' })).toThrow(/Invalid intent extra key/);
    expect(() => buildIntentUri(PKG, ACT, { 'ROM=X': '/a.gb' })).toThrow(/Invalid intent extra key/);
  });

  it('coerces non-string extra values', () => {
    expect(buildIntentUri(PKG, ACT, { PORT: 5555 })).toContain('S.PORT=5555');
  });
});
