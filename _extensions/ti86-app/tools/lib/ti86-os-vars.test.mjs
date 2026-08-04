import { describe, expect, it } from 'vitest';
import { Z80Emitter } from './z80-emitter.mjs';
import {
  TI86_ROM,
  emitReplaceTi86Variable,
  emitReplaceTi86String,
  ti86VariableNameDescriptor,
} from './ti86-os-vars.mjs';

describe('TI-86 OS variable helpers', () => {
  it('encodes String variable names in the ten-byte OP1 shape', () => {
    expect(ti86VariableNameDescriptor('dsinfo')).toEqual(Buffer.from([
      0x0C, 0x06, 0x44, 0x53, 0x49, 0x4E, 0x46, 0x4F, 0x00, 0x00,
    ]));
    expect(() => ti86VariableNameDescriptor('TOO-LONG!')).toThrow(/variable name/);
  });

  it('emits a bounded TI-OS create/replace and paged-memory copy sequence', () => {
    const z = new Z80Emitter({ origin: 0xD748 });
    emitReplaceTi86String(z, {
      nameLabel: 'name', dataLabel: 'data', dataLength: 3,
    });
    z.emit(0xC9);
    z.label('name'); z.emit(...ti86VariableNameDescriptor('DSINFO'));
    z.label('data'); z.emit(1, 2, 3);
    const code = z.finish();

    expect(code.includes(Buffer.from([0xE7, 0xD7, 0xD4, 0x5F, 0x47]))).toBe(true);
    expect(code.includes(Buffer.from([
      0xCD, TI86_ROM.createString & 0xFF, TI86_ROM.createString >>> 8,
      0xCD, TI86_ROM.exchangeAhlBde & 0xFF, TI86_ROM.exchangeAhlBde >>> 8,
    ]))).toBe(true);
    expect(code.subarray(-13)).toEqual(Buffer.concat([
      ti86VariableNameDescriptor('DSINFO'), Buffer.from([1, 2, 3]),
    ]));
  });

  it('copies a complete variable payload so Asm( marker length stays faithful', () => {
    const z = new Z80Emitter({ origin: 0xD748 });
    emitReplaceTi86Variable(z, {
      nameLabel: 'name', dataLabel: 'data', variableDataLength: 6,
      creator: TI86_ROM.createProgram,
    });
    z.emit(0xC9);
    z.label('name'); z.emit(...ti86VariableNameDescriptor('SCHL', 0x12));
    z.label('data'); z.emit(2, 0, 0x8E, 0x28, 0xC9, 0xC9);
    const code = z.finish();
    expect(code.includes(Buffer.from([0xCD, 0x4F, 0x47]))).toBe(true);
    expect(code.includes(Buffer.from([0x21, 0x06, 0x00, 0xCD, 0x4F, 0x46]))).toBe(true);
    expect(code.subarray(-16)).toEqual(Buffer.concat([
      ti86VariableNameDescriptor('SCHL', 0x12), Buffer.from([2, 0, 0x8E, 0x28, 0xC9, 0xC9]),
    ]));
  });
});
