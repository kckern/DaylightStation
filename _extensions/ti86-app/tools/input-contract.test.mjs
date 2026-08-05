import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { verifyTi86Program } from './lib/ti86-program.mjs';
import {
  TI86_ON_INTERRUPT_FLAG,
  TI86_RAW_SCAN_CODE,
  TI86_ROM,
} from './lib/ti86-os-vars.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(HERE, '..');
const INCLUDE = readFileSync(path.join(EXTENSION, 'src', 'ti86asm.inc'), 'utf8');

describe('TI-86 input safety boundary', () => {
  it('keeps SchoolCalc on TI-86 physical raw event codes', () => {
    const assemblyNames = {
      none: 'SC_SCAN_NONE', down: 'SC_SCAN_DOWN', left: 'SC_SCAN_LEFT',
      right: 'SC_SCAN_RIGHT', up: 'SC_SCAN_UP', enter: 'SC_SCAN_ENTER',
      clear: 'SC_SCAN_CLEAR', f5: 'SC_SCAN_F5',
      f4: 'SC_SCAN_F4', f3: 'SC_SCAN_F3', f2: 'SC_SCAN_F2',
      f1: 'SC_SCAN_F1', exit: 'SC_SCAN_EXIT',
      more: 'SC_SCAN_MORE',
    };
    for (const [key, name] of Object.entries(assemblyNames)) {
      expect(readHexEquate(INCLUDE, name), name).toBe(TI86_RAW_SCAN_CODE[key]);
    }
    expect(readDecimalEquate(INCLUDE, 'SC_ON_FLAGS')).toBe(TI86_ON_INTERRUPT_FLAG.offset);
    expect(readDecimalEquate(INCLUDE, 'SC_ON_INTERRUPT')).toBe(TI86_ON_INTERRUPT_FLAG.bit);
  });

  it('gives every assembly UI Back, explicit quit, ON safety, and contrast chords', () => {
    const input = readFileSync(path.join(EXTENSION, 'src', 'input.asm'), 'utf8');
    expect(input).toContain('bit SC_ON_INTERRUPT,(iy+SC_ON_FLAGS)');
    expect(input).toContain('sc_input_read_raw:');
    expect(input).toContain('out (1),a');
    expect(input).toContain('in a,(1)');
    expect(input).toContain('ld a,$FE');
    expect(input).toContain('sc_input_arm_second:');
    expect(input).toContain('sc_input_contrast_up:');
    expect(input).toContain('sc_input_contrast_down:');
    expect(input).toContain('out (SC_CONTRAST_PORT),a');
    expect(input).toContain('jr sc_input_wait');
    expect(input).toContain('cp SC_SCAN_CLEAR');
    expect(input).toContain('sc_input_clear_to_back:');
    expect(input).toContain('ld a,SC_SCAN_EXIT');
    expect(input).toContain('jp _JforceCmdNoChar');
    expect(input).toMatch(/sc_input_wait_release:[\s\S]*?call sc_input_read_raw[\s\S]*?jr nz,sc_input_release_wait[\s\S]*?call sc_input_debounce_delay[\s\S]*?call sc_input_read_raw[\s\S]*?ret z/);
    expect(input).toMatch(/sc_input_debounce_delay:[\s\S]*?ld b,0[\s\S]*?djnz sc_input_debounce_loop/);
    expect(input).toMatch(/sc_input_wait:[\s\S]*?call sc_input_poll[\s\S]*?or a[\s\S]*?ret nz[\s\S]*?jr sc_input_wait/);

    for (const name of ['schoolcalc.asm', 'ui-renderer-probe.asm', 'record-reader-probe.asm']) {
      const source = readFileSync(path.join(EXTENSION, 'src', name), 'utf8');
      expect(source, name).toContain('call sc_input_init');
      expect(source, name).toContain('call sc_input_wait');
      expect(source, name).toContain('include "input.asm"');
      expect(source, name).not.toMatch(/call\s+_get_?key/i);
    }
  });

  it('keeps physical matrix codes aligned with the disposable device diagnostic', () => {
    expect(TI86_RAW_SCAN_CODE.on).toBe(0x29);
    expect(TI86_RAW_SCAN_CODE.clear).toBe(0x0F);
    expect(TI86_RAW_SCAN_CODE.exit).toBe(0x37);
  });

  it('releases a held child-runtime key before the restored SchoolCalc shell can read it', () => {
    const shell = readFileSync(path.join(EXTENSION, 'src', 'schoolcalc.asm'), 'utf8');
    const launches = [
      'launch_standard_runtime', 'launch_qr_runtime', 'launch_profile_runtime',
      'launch_tutor_runtime', 'launch_catalog_runtime', 'launch_sync_runtime',
    ];
    for (const launch of launches) {
      expect(shell, launch).toMatch(new RegExp(`${launch}:[\\s\\S]*?call _exec_assembly[\\s\\S]*?call sc_input_wait_release[\\s\\S]*?call local_state_load`));
    }
  });

  it('packages SCINFO with raw EXIT/ENTER, ON-flag, idle, and forced OS return', () => {
    execFileSync(process.execPath, [path.join(EXTENSION, 'tools', 'build-device-info-probe.mjs')], {
      cwd: path.resolve(EXTENSION, '..', '..'),
      stdio: 'pipe',
    });
    const file = readFileSync(path.join(EXTENSION, 'dist', 'SCINFO.86p'));
    const { code } = verifyTi86Program(file, { expectedName: 'SCINFO' });

    expect(code.indexOf(Buffer.from([0xFD, 0xCB, 0x09, 0x66]))).toBeGreaterThanOrEqual(0);
    expect(code.indexOf(Buffer.from([0xFE, TI86_RAW_SCAN_CODE.on]))).toBeGreaterThanOrEqual(0);
    expect(code.indexOf(Buffer.from([0xFE, TI86_RAW_SCAN_CODE.clear]))).toBeGreaterThanOrEqual(0);
    expect(code.indexOf(Buffer.from([0xFE, TI86_RAW_SCAN_CODE.exit]))).toBeGreaterThanOrEqual(0);
    expect(code.indexOf(Buffer.from([0xFE, TI86_RAW_SCAN_CODE.enter]))).toBeGreaterThanOrEqual(0);
    expect(code.indexOf(Buffer.from(callBytes(TI86_ROM.idle)))).toBeGreaterThanOrEqual(0);
    expect(code.indexOf(Buffer.from([
      ...callBytes(TI86_ROM.runIndicatorOff),
      ...callBytes(TI86_ROM.clearLcd),
      0xC3,
      TI86_ROM.forceCommandNoCharacter & 0xFF,
      TI86_ROM.forceCommandNoCharacter >>> 8,
    ]))).toBeGreaterThanOrEqual(0);
  });
});

function readHexEquate(source, name) {
  const match = source.match(new RegExp(`^${name}:\\s+equ \\$([0-9A-F]+)$`, 'mi'));
  if (!match) throw new Error(`missing hexadecimal equate ${name}`);
  return Number.parseInt(match[1], 16);
}

function readDecimalEquate(source, name) {
  const match = source.match(new RegExp(`^${name}:\\s+equ ([0-9]+)$`, 'mi'));
  if (!match) throw new Error(`missing decimal equate ${name}`);
  return Number.parseInt(match[1], 10);
}

function callBytes(address) {
  return [0xCD, address & 0xFF, address >>> 8];
}
