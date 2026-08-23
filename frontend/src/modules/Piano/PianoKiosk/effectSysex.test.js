import { describe, it, expect } from 'vitest';
import { gsChecksum, gsMessage, gm2Message, planEffectSysex, toHex } from './effectSysex.js';

// These bytes are the contract with a physical instrument that has NO read-back —
// a wrong checksum is silently ignored by the piano, which is indistinguishable
// from "effects still don't work". So the golden values here are transcribed from
// the verified table in piano/config.yml and confirmed on the wire 2026-08-22
// (JamCorder ble.in / uartOut both incremented for the reverb message below).

describe('gsChecksum', () => {
  it('matches the Roland rule 128 - (sum mod 128)', () => {
    // addr 40 01 30 + data 04 -> 117 -> 128-117 = 11 (0x0B)
    expect(gsChecksum([0x40, 0x01, 0x30, 0x04])).toBe(0x0b);
  });

  it('wraps a full 128 back to 0 rather than emitting a non-7-bit byte', () => {
    // sum mod 128 === 0 would give 128, which is not a legal MIDI data byte.
    expect(gsChecksum([0x40, 0x40])).toBe(0);
    expect(gsChecksum([0x00])).toBe(0);
  });
});

describe('gsMessage', () => {
  it('builds the verified GS reverb-type message', () => {
    // The exact bytes sent on-device; the JamCorder forwarded them to the piano.
    expect(toHex(gsMessage([0x40, 0x01, 0x30], [0x04])))
      .toBe('F0 41 10 42 12 40 01 30 04 0B F7');
  });

  it('frames every message with F0…F7', () => {
    const m = gsMessage([0x40, 0x01, 0x33], [0x64]);
    expect(m[0]).toBe(0xf0);
    expect(m[m.length - 1]).toBe(0xf7);
  });
});

describe('gm2Message', () => {
  it('uses kind 00 for reverb and 02 for chorus, with no checksum', () => {
    expect(toHex(gm2Message(0x00, 4))).toBe('F0 7F 7F 04 05 01 01 01 01 01 00 04 F7');
    expect(toHex(gm2Message(0x02, 2))).toBe('F0 7F 7F 04 05 01 01 01 01 01 02 02 F7');
  });
});

describe('planEffectSysex', () => {
  it('gm2 (the configured default) sends type as SysEx and level on its CC', () => {
    const ops = planEffectSysex('reverb', { type: 4, level: 100, on: true }, { levelCC: 91 });
    expect(ops).toEqual([
      { kind: 'sysex', bytes: gm2Message(0x00, 4) },
      { kind: 'cc', cc: 91, value: 100 },
    ]);
  });

  it('gs sends BOTH type and level as SysEx', () => {
    const ops = planEffectSysex('chorus', { type: 2, level: 64, on: true }, { dialect: 'gs' });
    expect(ops).toHaveLength(2);
    expect(ops.every((o) => o.kind === 'sysex')).toBe(true);
    expect(toHex(ops[0].bytes)).toBe(toHex(gsMessage([0x40, 0x01, 0x38], [2])));
  });

  it('off sends level 0 while KEEPING the type — same semantics the CC path had', () => {
    // The UI's toggle has always meant "level 0", not a distinct disable command.
    // Changing that here would silently alter behaviour people are used to.
    const ops = planEffectSysex('reverb', { type: 8, level: 120, on: false }, { levelCC: 91 });
    expect(ops[0]).toEqual({ kind: 'sysex', bytes: gm2Message(0x00, 8) });
    expect(ops[1]).toEqual({ kind: 'cc', cc: 91, value: 0 });
  });

  it('clamps out-of-range values to legal 7-bit MIDI data bytes', () => {
    const ops = planEffectSysex('reverb', { type: 999, level: -5, on: true }, { levelCC: 91 });
    expect(ops[0].bytes.every((b) => b === 0xf0 || b === 0xf7 || b <= 0x7f)).toBe(true);
    expect(ops[1].value).toBe(0);
  });

  it('omits the level CC when the device defines no levelCC', () => {
    const ops = planEffectSysex('reverb', { type: 4, level: 100, on: true }, {});
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('sysex');
  });

  it('returns nothing for an unknown effect or a typeless patch', () => {
    expect(planEffectSysex('phaser', { type: 1, level: 1, on: true })).toEqual([]);
    expect(planEffectSysex('reverb', { level: 10, on: true })).toEqual([]);
    expect(planEffectSysex('reverb', null)).toEqual([]);
  });
});
