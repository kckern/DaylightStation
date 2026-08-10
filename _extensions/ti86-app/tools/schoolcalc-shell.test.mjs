import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeTi86Envelope } from '../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';
import { TI86_SCHOOLCALC_LIMITS } from '../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcLimits.mjs';
import {
  TI86_ASM_EXEC_RAM,
  TI86_VIDEO_RAM,
  verifyTi86Program,
} from './lib/ti86-program.mjs';
import {
  SCHOOLCALC_LOCAL_STATE_BYTES,
  decodeSchoolCalcLocalState,
} from './lib/schoolcalc-local-state.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(HERE, '..');
const SHELL_SOURCE = readFileSync(path.join(EXTENSION, 'src', 'schoolcalc.asm'), 'utf8');

describe('SchoolCalc production shell build', () => {
  it('assembles a bounded SCHLCALC program with a valid fail-closed DSINFO template', () => {
    execFileSync(process.execPath, [path.join(EXTENSION, 'tools', 'build-schoolcalc-shell.mjs')], {
      cwd: path.resolve(EXTENSION, '..', '..'),
      stdio: 'pipe',
    });
    const file = readFileSync(path.join(EXTENSION, 'dist', 'SCHLCALC.86p'));
    const { name, code } = verifyTi86Program(file, { expectedName: 'SCHLCALC' });
    expect(name).toBe('SCHLCALC');
    expect(TI86_ASM_EXEC_RAM + code.length).toBeLessThanOrEqual(TI86_VIDEO_RAM);
    expect(code.length).toBeLessThanOrEqual(TI86_SCHOOLCALC_LIMITS.shellMaxBytes);

    const deviceInfoRecords = findValidEnvelopes(code, 'SCI1')
      .filter((record) => record.value.schema === 'school.calc.device-info/v1');
    expect(deviceInfoRecords).toHaveLength(1);
    expect(deviceInfoRecords[0].value).toEqual({
      capabilities: ['shell-core@1'],
      freeBytes: 0,
      installedArtifactIds: [],
      maxArtifactBytes: TI86_SCHOOLCALC_LIMITS.lessonMaxBytes,
      runtimeModuleMask: 0,
      schema: 'school.calc.device-info/v1',
      shellVersion: '0.1.0',
    });
    expect(code.includes(Buffer.from([
      0x0C, 0x06, 0x44, 0x53, 0x49, 0x4E, 0x46, 0x4F, 0x00, 0x00,
    ]))).toBe(true);

    const localStates = findFixedRecords(code, 'SCL1', SCHOOLCALC_LOCAL_STATE_BYTES)
      .map((record) => decodeSchoolCalcLocalState(record));
    expect(localStates).toEqual([expect.objectContaining({
      generation: 0,
      view: 'home',
      focus: 0,
      nextSequence: 0,
    })]);
    expect(code.includes(Buffer.from([0x0C, 0x08, ...Buffer.from('DSLOCAL0', 'ascii')]))).toBe(true);
    expect(code.includes(Buffer.from([0x0C, 0x08, ...Buffer.from('DSLOCAL1', 'ascii')]))).toBe(true);
    expect(SHELL_SOURCE).toContain('call local_state_copy_candidate');
    expect(SHELL_SOURCE).toMatch(
      /local_state_save:[\s\S]*?SCL_FLAGS_ADDR[\s\S]*?SCL_SESSION_LEARNER_ADDR[\s\S]*?local_state_session_identity_ready/,
    );
    expect(SHELL_SOURCE).toMatch(/publish_device_info:\s+call discover_runtime_modules[\s\S]*?DSINFO_RUNTIME_MASK_ADDR/);
    expect(SHELL_SOURCE).toMatch(/discover_runtime_modules:[\s\S]*?call validate_installed_runtime/);
    expect(SHELL_SOURCE).toMatch(/validate_installed_runtime:[\s\S]*?runtime_header_prefix[\s\S]*?runtime_expected_crc/);
    const bootPath = SHELL_SOURCE.match(/start:[\s\S]*?jp launch_profile_runtime/)?.[0] ?? '';
    expect(bootPath).not.toContain('call publish_device_info');
    expect(bootPath).toContain('call sync_commit_staged');
    expect(SHELL_SOURCE).not.toContain('include "content-hydration.asm"');
    expect(SHELL_SOURCE).toContain('include "generated/ui-shell-assets.inc"');
    expect(SHELL_SOURCE).toMatch(
      /shell_code_glyph_pointer:\s+cp '-'\s+jr nz,shell_code_glyph_digit\s+xor a\s+jr shell_code_glyph_index_ready/,
    );
    expect(SHELL_SOURCE).toMatch(/ld hl,code_instruction\s+ld b,32\s+ld c,15/);
    expect(SHELL_SOURCE).toMatch(/ld hl,code_prompt\s+ld b,36/);
    const codeRefresh = SHELL_SOURCE.match(/shell_code_refresh:[\s\S]*?shell_draw_code_status:/)?.[0] ?? '';
    expect(codeRefresh).toContain('call ui_mode_clear');
    expect(codeRefresh).not.toContain('call shell_draw_code_display');
    expect(codeRefresh).not.toContain('call _clrLCD');
    expect(SHELL_SOURCE).toMatch(
      /call shell_code_accept_digit\s+or a\s+jr z,wait_key_regular\s+call shell_code_draw_entered_digit\s+ld a,\(shell_code_length\)\s+cp 6\s+jp nz,wait_key\s+call shell_code_refresh\s+call shell_code_refresh_f1/,
    );
    expect(SHELL_SOURCE).toMatch(
      /shell_code_draw_entered_digit:[\s\S]*?ld hl,shell_code_digit_x[\s\S]*?call ui_fill_rect[\s\S]*?call shell_code_glyph_pointer[\s\S]*?jp ui_draw_bitmap/,
    );
    expect(SHELL_SOURCE).toMatch(
      /shell_code_open_ready:[\s\S]*?ld \(shell_code_status\),a\s+call shell_code_refresh\s+call shell_code_matches_study/,
    );
    expect(SHELL_SOURCE).toContain('code_ready:              defb "ENTER TO OPEN",0');
    expect(SHELL_SOURCE).toContain('code_opening:            defb "OPENING...",0');
    expect(SHELL_SOURCE).toMatch(/shell_f4:\s+jp wait_key/);
    expect(SHELL_SOURCE).toMatch(/shell_f5:[\s\S]*?cp SCREEN_CODE\s+jp z,sc_input_force_exit/);
    expect(SHELL_SOURCE).toMatch(/shell_code_open:\s+ld a,\(shell_code_length\)\s+cp 6\s+jp nz,wait_key/);
    expect(SHELL_SOURCE).not.toContain('shell_resume_available');
    expect(SHELL_SOURCE).not.toContain('shell_code_clear_entry');
    expect(SHELL_SOURCE).toMatch(/shell_code_refresh_f1:[\s\S]*?cp 6\s+ret nz[\s\S]*?ld hl,softkey_open/);
    expect(SHELL_SOURCE).toMatch(/shell_softkey_f1_ready:\s+ld b,2/);
    expect(SHELL_SOURCE).toContain('softkey_open:           defb " OPEN",0');
    expect(SHELL_SOURCE).toContain('softkey_exit:           defb "EXIT",0');
    expect(SHELL_SOURCE).not.toContain('softkey_resume');
    expect(SHELL_SOURCE).not.toContain('softkey_clear');
    expect(SHELL_SOURCE).toContain('NO RELAY DETECTED');
    expect(SHELL_SOURCE).toContain('Safe to unplug');
    expect(SHELL_SOURCE).not.toContain('Cable: connected');
    expect(SHELL_SOURCE).toContain('scsync_name:    defb 0x12,6,"SCSYNC",0,0');
    expect(SHELL_SOURCE).toMatch(
      /launch_sync_runtime:[\s\S]*?call publish_device_info[\s\S]*?ld hl,scsync_name[\s\S]*?call _exec_assembly[\s\S]*?call sync_commit_staged/,
    );
  });
});

function findValidEnvelopes(bytes, magic) {
  const signature = Buffer.from(magic, 'ascii');
  const records = [];
  for (let offset = bytes.indexOf(signature); offset >= 0;
    offset = bytes.indexOf(signature, offset + 1)) {
    if (offset + 9 > bytes.length) continue;
    const end = offset + 9 + bytes.readUInt16LE(offset + 5);
    if (end > bytes.length) continue;
    try {
      records.push({
        offset,
        value: decodeTi86Envelope(bytes.subarray(offset, end), magic),
      });
    } catch {
      // A runtime comparison literal may share the envelope magic.
    }
  }
  return records;
}

function findFixedRecords(bytes, magic, byteLength) {
  const signature = Buffer.from(magic, 'ascii');
  const records = [];
  for (let offset = bytes.indexOf(signature); offset >= 0;
    offset = bytes.indexOf(signature, offset + 1)) {
    if (offset + byteLength > bytes.length) continue;
    const candidate = bytes.subarray(offset, offset + byteLength);
    try {
      decodeSchoolCalcLocalState(candidate);
      records.push(candidate);
    } catch {
      // Runtime comparison literals share the same magic.
    }
  }
  return records;
}
