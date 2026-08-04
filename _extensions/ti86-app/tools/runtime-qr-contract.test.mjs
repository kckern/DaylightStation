import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TI86_SCHOOLCALC_LIMITS } from '../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcLimits.mjs';
import {
  TI86_RESULT_QR_BLOCK_DATA_CODEWORDS,
  TI86_RESULT_QR_DATA_CODEWORDS,
  TI86_RESULT_QR_ECC_CODEWORDS,
  TI86_RESULT_QR_MAX_RECORD_BYTES,
  TI86_RESULT_QR_ORIGIN_X,
  TI86_RESULT_QR_ORIGIN_Y,
  TI86_RESULT_QR_SIZE,
  TI86_RESULT_QR_TOTAL_CODEWORDS,
} from './lib/ti86-result-qr-v5.mjs';
import {
  TI86_RUNTIME_MODULES,
  inspectTi86RuntimeProgram,
} from './lib/ti86-runtime-module.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(HERE, '..');
const ROOT = path.resolve(EXTENSION, '..', '..');
const SOURCE = readFileSync(path.join(EXTENSION, 'src', 'runtime-qr.asm'), 'utf8');
const SHELL = readFileSync(path.join(EXTENSION, 'src', 'schoolcalc.asm'), 'utf8');

describe('TI-86 SCQR runtime contract', () => {
  it('builds a bounded, self-validating closed runtime', () => {
    execFileSync(process.execPath, [path.join(EXTENSION, 'tools', 'build-qr-runtime.mjs')], {
      cwd: ROOT, stdio: 'pipe',
    });
    const file = readFileSync(path.join(EXTENSION, 'dist', 'SCQR.86p'));
    const inspected = inspectTi86RuntimeProgram(file, TI86_RUNTIME_MODULES.resultQr);
    expect(inspected).toEqual(expect.objectContaining({
      id: 'result-qr', moduleCode: 2, programName: 'SCQR', capabilities: [],
    }));
    expect(inspected.codeByteLength).toBeLessThanOrEqual(TI86_SCHOOLCALC_LIMITS.qrRuntimeMaxBytes);
    // SCHLCALC validates every immutable SCX1 runtime envelope before
    // dispatching it through TI-OS. SCQR therefore starts from that reviewed
    // boundary instead of revalidating the mutable execution copy in RAM.
    expect(SOURCE).toMatch(/scqr_start:[\s\S]{0,180}call _runindicoff[\s\S]{0,100}call scqr_load_latest_result/);
  });

  it('keeps every fixed QR constant aligned with the host-proven model', () => {
    expect(equate('SCQR_SIZE')).toBe(TI86_RESULT_QR_SIZE);
    expect(equate('SCQR_ORIGIN_X')).toBe(TI86_RESULT_QR_ORIGIN_X);
    expect(equate('SCQR_ORIGIN_Y')).toBe(TI86_RESULT_QR_ORIGIN_Y);
    expect(equate('SCQR_DATA_CODEWORDS')).toBe(TI86_RESULT_QR_DATA_CODEWORDS);
    expect(equate('SCQR_BLOCK_DATA_CODEWORDS')).toBe(TI86_RESULT_QR_BLOCK_DATA_CODEWORDS);
    expect(equate('SCQR_ECC_CODEWORDS')).toBe(TI86_RESULT_QR_ECC_CODEWORDS);
    expect(equate('SCQR_TOTAL_CODEWORDS')).toBe(TI86_RESULT_QR_TOTAL_CODEWORDS);
    expect(equate('SCQR_RESULT_MAX_BYTES')).toBe(TI86_RESULT_QR_MAX_RECORD_BYTES);
    expect(SOURCE).toContain('scqr_payload_prefix: defb "sch:r1:"');
    expect(SOURCE).toContain('scqr_base32_alphabet: defb "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"');
  });

  it('reads the newest checksum-valid queued result without mutating DSQ', () => {
    expect(SOURCE).toMatch(/call sc_envelope_open[\s\S]*?scqr_find_last_record:[\s\S]*?scqr_copy_latest_result:[\s\S]*?call scqr_validate_result/);
    expect(SOURCE).toMatch(/call crc16_ccitt_false[\s\S]*?scqr_validate_result_end/);
    expect(SOURCE).not.toMatch(/DSQB|queue_advance/);
    expect(SOURCE).toMatch(/call scqr_build_payload[\s\S]{0,100}call scqr_encode_data[\s\S]{0,100}call scqr_build_ecc[\s\S]{0,100}call _clrLCD/);
  });

  it('separates self-reported QR completion from link acknowledgement', () => {
    expect(SOURCE).toContain('scqr_dsqout_name: defb 0x0C,6,"DSQOUT",0,0');
    expect(SOURCE).toContain('scqr_sco1_magic: defb "SCO1"');
    expect(SOURCE).toMatch(/scqr_wait:[\s\S]{0,160}SC_SCAN_F1[\s\S]{0,80}scqr_mark_output_done[\s\S]{0,80}SC_SCAN_F5/);
    expect(SOURCE).toMatch(/scqr_mark_output_done:[\s\S]{0,900}scqr_store_output_receipt/);
    expect(SOURCE).toMatch(/scqr_store_output_receipt:[\s\S]{0,520}_createstrng/);
    expect(SOURCE).toMatch(/scqr_draw_output_rail:[\s\S]{0,360}scqr_done_label[\s\S]{0,180}scqr_later_label/);
  });

  it('uses a fixed shell-owned dispatch and leaves the queue as the recovery point', () => {
    expect(SHELL).toContain('scqr_name:      defb 0x12,4,"SCQR",0,0,0,0');
    expect(SHELL).toMatch(/launch_qr_runtime:[\s\S]{0,220}call local_state_save[\s\S]*?call _exec_assembly[\s\S]*?call local_state_load/);
    expect(SHELL).toContain('cp SCREEN_RESULT\n        jp z,launch_qr_runtime');
    expect(SHELL).not.toMatch(/hydrate_.*(?:SCQR|program)/i);
  });
});

function equate(name) {
  const match = SOURCE.match(new RegExp(`^${name}:\\s+equ\\s+([0-9]+)$`, 'm'));
  if (!match) throw new Error(`missing numeric assembly equate ${name}`);
  return Number(match[1]);
}
