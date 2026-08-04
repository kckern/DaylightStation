import { describe, expect, it } from 'vitest';
import {
  createTi86AsmProgram,
  createTi86BasicProgram,
  createTi86ProgramGroup,
  verifyTi86BasicProgram,
  verifyTi86Program,
  verifyTi86ProgramGroup,
} from './ti86-program.mjs';
import { Z80Emitter } from './z80-emitter.mjs';

describe('TI-86 assembly program container', () => {
  it('round-trips exact code and rejects checksum corruption', () => {
    const code = Buffer.from([0xAF, 0xC9]);
    const file = createTi86AsmProgram({ name: 'SCTEST', code, comment: 'test' });
    expect(verifyTi86Program(file, { expectedName: 'SCTEST', expectedCode: code }).code).toEqual(code);
    const corrupt = Buffer.from(file);
    corrupt[corrupt.length - 1] ^= 1;
    expect(() => verifyTi86Program(corrupt)).toThrow(/checksum/);
  });

  it('resolves absolute labels at the configured execution origin', () => {
    const z = new Z80Emitter({ origin: 0xD748 });
    z.jump('done');
    z.emit(0x00);
    z.label('done');
    z.emit(0xC9);
    expect([...z.finish()]).toEqual([0xC3, 0x4C, 0xD7, 0x00, 0xC9]);
  });

  it('groups several assembly programs into one checksummed transfer', () => {
    const first = createTi86AsmProgram({ name: 'SCONE', code: Buffer.from([0xC9]) });
    const second = createTi86AsmProgram({ name: 'SCTWO', code: Buffer.from([0x00, 0xC9]) });
    const group = createTi86ProgramGroup({ programFiles: [first, second] });
    const inspected = verifyTi86ProgramGroup(group, { expectedNames: ['SCONE', 'SCTWO'] });
    expect(inspected.programs.map(({ name, code }) => ({ name, code: [...code] }))).toEqual([
      { name: 'SCONE', code: [0xC9] },
      { name: 'SCTWO', code: [0x00, 0xC9] },
    ]);
    const corrupt = Buffer.from(group);
    corrupt[corrupt.length - 1] ^= 1;
    expect(() => verifyTi86ProgramGroup(corrupt)).toThrow(/checksum/);
    expect(() => createTi86ProgramGroup({ programFiles: [first, first] })).toThrow(/repeats/);
  });
});

describe('TI-86 BASIC program container', () => {
  it('stores the editable token stream with its TI-86 length word', () => {
    const tokens = Buffer.from([0x8E, 0x25, 0x39, ...Buffer.from('phoenix'), 0x11]);
    const file = createTi86BasicProgram({ name: 'PHX', tokens, comment: 'test' });
    const inspected = verifyTi86BasicProgram(file, { expectedName: 'PHX', expectedTokens: tokens });
    expect(inspected.tokens).toEqual(tokens);
    expect(file.readUInt16LE(57)).toBe(tokens.length + 2);
    expect(file.readUInt16LE(71)).toBe(tokens.length);
    expect(file.subarray(73, 73 + tokens.length)).toEqual(tokens);
  });
});
