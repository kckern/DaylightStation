// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  cc, rolandChecksum, gsParam, GS_RESET, gsReverbLevel, GM_SYSTEM_ON,
  XG_SYSTEM_ON, xgReverbType, gm2ReverbType, isSysex,
} from './sysex.js';

describe('cc', () => {
  it('builds a Control Change with masked bytes', () => {
    expect(cc(91, 127)).toEqual([0xb0, 91, 127]);
    expect(cc(91, 200)).toEqual([0xb0, 91, 0x48]); // 200 & 0x7f
  });
});

describe('rolandChecksum', () => {
  it('matches the canonical GS Reset checksum (0x41)', () => {
    // address 40 00 7F, data 00  ->  checksum 0x41
    expect(rolandChecksum([0x40, 0x00, 0x7f, 0x00])).toBe(0x41);
  });
});

describe('GS_RESET', () => {
  it('is the canonical Roland GS reset message', () => {
    expect(GS_RESET).toEqual([0xf0, 0x41, 0x10, 0x42, 0x12, 0x40, 0x00, 0x7f, 0x00, 0x41, 0xf7]);
  });
});

describe('gsParam / gsReverbLevel', () => {
  it('wraps address+data with a valid checksum and F0..F7 frame', () => {
    const m = gsReverbLevel(100); // addr 40 01 33, data 100
    expect(m[0]).toBe(0xf0);
    expect(m[m.length - 1]).toBe(0xf7);
    expect(m.slice(5, 9)).toEqual([0x40, 0x01, 0x33, 100]);
    expect(m[9]).toBe(rolandChecksum([0x40, 0x01, 0x33, 100]));
  });
});

describe('XG', () => {
  it('system-on is the canonical XG ON message', () => {
    expect(XG_SYSTEM_ON).toEqual([0xf0, 0x43, 0x10, 0x4c, 0x00, 0x00, 0x7e, 0x00, 0xf7]);
  });
  it('reverb type frames address + 2 data bytes', () => {
    expect(xgReverbType(1, 0)).toEqual([0xf0, 0x43, 0x10, 0x4c, 0x02, 0x01, 0x00, 0x01, 0x00, 0xf7]);
  });
});

describe('GM / GM2', () => {
  it('GM system-on is correct', () => {
    expect(GM_SYSTEM_ON).toEqual([0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7]);
  });
  it('GM2 reverb type frames a value', () => {
    const m = gm2ReverbType(4);
    expect(m[0]).toBe(0xf0);
    expect(m[m.length - 1]).toBe(0xf7);
    expect(m[m.length - 2]).toBe(4);
  });
});

describe('isSysex', () => {
  it('detects F0-led messages', () => {
    expect(isSysex(GS_RESET)).toBe(true);
    expect(isSysex(cc(91, 0))).toBe(false);
  });
});
