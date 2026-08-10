import { describe, expect, it } from 'vitest';
import { TI86_ASM_EXEC_RAM } from './lib/ti86-program.mjs';
import { TI86_ROM } from './lib/ti86-os-vars.mjs';
import {
  MAME_TI86_KEYS,
  createTi86MameArguments,
  createTi86MameInputScript,
  identifyTi86Rom,
  normalizeMameTi86Key,
} from './lib/ti86-mame.mjs';

describe('TI-86 MAME safety gate', () => {
  it('identifies every published MAME TI-86 ROM without accepting unknown dumps', () => {
    expect(identifyTi86Rom({
      byteLength: 0x40000,
      digest: 'b5ad204885e5dde23a22f18f8d5eaffca69d638d',
    })).toMatchObject({ bios: 'v16', version: '1.6', filename: 'ti86v16.bin' });
    expect(() => identifyTi86Rom({ byteLength: 1, digest: 'x' }))
      .toThrow(/exactly 262144 bytes/);
    expect(() => identifyTi86Rom({ byteLength: 0x40000, digest: '0'.repeat(40) }))
      .toThrow(/unrecognized TI-86 ROM/);
  });

  it('uses the TI-86 driver matrix positions for safety and navigation keys', () => {
    expect(MAME_TI86_KEYS).toMatchObject({
      ENTER: { port: ':BIT0', mask: 0x02 },
      EXIT: { port: ':BIT6', mask: 0x40 },
      CLEAR: { port: ':BIT6', mask: 0x02 },
      SECOND: { port: ':BIT5', mask: 0x40 },
      ON: { port: ':ON', mask: 0x01 },
      UP: { port: ':BIT3', mask: 0x01 },
      F1: { port: ':BIT4', mask: 0x40 },
      '0': { port: ':BIT0', mask: 0x10 },
      '1': { port: ':BIT1', mask: 0x10 },
      '9': { port: ':BIT3', mask: 0x04 },
    });
    expect(normalizeMameTi86Key(' exit ')).toBe('EXIT');
    expect(() => normalizeMameTi86Key('ESC')).toThrow(/unsupported/);
  });

  it('injects exact bytes and marks the TI-OS forced-return breakpoint', () => {
    const code = Buffer.from([0x3E, 0x37, 0xC3, 0x9C, 0x40]);
    const script = createTi86MameInputScript({ code, key: 'EXIT' });
    expect(script).toContain('local code = {\n  62, 55, 195, 156, 64\n}');
    expect(script).toContain(`local ORIGIN = 0x${TI86_ASM_EXEC_RAM.toString(16).toUpperCase()}`);
    expect(script).toContain(`local FORCE_EXIT = 0x${TI86_ROM.forceCommandNoCharacter.toString(16).toUpperCase()}`);
    expect(script).toContain("local port = ports[':BIT6']");
    expect(script).toContain('local field = port and port:field(0x40) or nil');
    expect(script).toContain("cpu.debug:bpset(FORCE_EXIT, nil, string.format('b@%X = 1 ; g', MARKER))");
    expect(script).toContain("manager.machine.debugger:command(string.format('do pc = %X', ORIGIN))");
    expect(script).toContain("manager.machine.debugger:command('g')");
    expect(script).toContain('SCHOOLCALC_MAME_');
  });

  it('constructs an isolated headless MAME invocation', () => {
    expect(createTi86MameArguments({
      bios: 'v16',
      romPath: '/tmp/roms',
      scriptPath: '/tmp/gate.lua',
      debugScriptPath: '/tmp/resume.cmd',
      workPath: '/tmp/run',
    })).toEqual(expect.arrayContaining([
      'ti86', '-bios', 'v16', '-rompath', '/tmp/roms', '-autoboot_script',
      '/tmp/gate.lua', '-debug', '-debugger', 'none', '-video', 'none',
      '-sound', 'none',
    ]));
  });
});
