import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { crc16Ccitt } from '../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';
import { TI86_SCHOOLCALC_LIMITS } from '../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcLimits.mjs';
import { TI86_ASM_EXEC_RAM, TI86_VIDEO_RAM } from './lib/ti86-program.mjs';
import {
  TI86_RUNTIME_MODULES,
  inspectTi86RuntimeProgram,
} from './lib/ti86-runtime-module.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(HERE, '..');
const ROOT = path.resolve(EXTENSION, '..', '..');
const SOURCE_PATH = path.join(EXTENSION, 'src', 'runtime-sync.asm');
const SOURCE = readFileSync(SOURCE_PATH, 'utf8');
const SHELL = readFileSync(path.join(EXTENSION, 'src', 'schoolcalc.asm'), 'utf8');
const RELAY_WIRE = readFileSync(path.join(
  ROOT, '_extensions', 'ticalc-relay', 'firmware', 'src', 'SchoolCalcForegroundWire.h',
), 'utf8');

describe('TI-86 cooperative foreground-sync runtime', () => {
  it('builds the exact reviewed SCSYNC ABI inside its independent execution window', () => {
    execFileSync(process.execPath, [path.join(EXTENSION, 'tools', 'build-sync-runtime.mjs')], {
      cwd: ROOT,
      stdio: 'pipe',
    });
    const file = readFileSync(path.join(EXTENSION, 'dist', 'SCSYNC.86p'));
    const inspected = inspectTi86RuntimeProgram(file, TI86_RUNTIME_MODULES.foregroundSync);
    expect(inspected).toEqual(expect.objectContaining({
      abiVersion: 1,
      id: 'foreground-sync',
      moduleCode: 6,
      programName: 'SCSYNC',
      capabilities: [],
    }));
    expect(inspected.codeByteLength).toBeLessThanOrEqual(TI86_SCHOOLCALC_LIMITS.syncRuntimeMaxBytes);
    expect(TI86_ASM_EXEC_RAM + inspected.codeByteLength).toBeLessThanOrEqual(TI86_VIDEO_RAM);
  });

  it('uses concise recovery copy while an unavailable study waits for its relay', () => {
    expect(SOURCE).toContain('sync_ui_checking:           defb "CONNECT RELAY",0');
    expect(SOURCE).toContain('sync_ui_wait_relay:         defb "WAITING FOR LINK",0');
    expect(SOURCE).toContain('sync_ui_no_transfer:        defb "EXIT PAUSES SAFELY",0');
    expect(SOURCE).not.toContain('No data moving');
  });

  it('animates an indeterminate link meter while polling for an absent relay', () => {
    expect(SOURCE).toMatch(/link_cancel_probe:[\s\S]*?sync_connected[\s\S]*?call z,sync_wait_activity_tick/);
    expect(SOURCE).toMatch(/sync_wait_activity_tick:[\s\S]*?sync_wait_divider[\s\S]*?and 3[\s\S]*?jp sync_draw_wait_activity/);
    expect(SOURCE).toMatch(/sync_draw_wait_activity:[\s\S]*?ld b,24[\s\S]*?ld d,101[\s\S]*?sync_wait_phase[\s\S]*?ld d,20/);
    expect(SOURCE).toContain('sync_ui_activity:           defb "LINK",0');
  });

  it('locks the calculator offer and frame envelope to the relay SCF1 v1 contract', () => {
    expect(asmEqu('SCF_FRAME_HEADER_BYTES')).toBe(cxxConstant('FRAME_HEADER_BYTES'));
    expect(asmEqu('SCF_FRAME_MAX_BYTES')).toBe(
      cxxConstant('FRAME_HEADER_BYTES')
      + cxxConstant('MAX_PAYLOAD_BYTES')
      + cxxConstant('FRAME_CRC_BYTES'),
    );
    expect(asmEqu('SCF_PAYLOAD_MAX_BYTES')).toBe(cxxConstant('MAX_PAYLOAD_BYTES'));
    expect(asmEqu('SCF_CHUNK_BYTES')).toBe(cxxConstant('DEFAULT_CHUNK_BYTES'));
    expect(asmEqu('SCF_TYPE_HELLO')).toBe(cxxEnum('Hello'));
    expect(asmEqu('SCF_TYPE_HELLO_ACK')).toBe(cxxEnum('HelloAck'));
    expect(asmEqu('SCF_TYPE_PHASE')).toBe(cxxEnum('Phase'));
    expect(asmEqu('SCF_TYPE_READ_REQUEST')).toBe(cxxEnum('ReadRequest'));
    expect(asmEqu('SCF_TYPE_WRITE_BEGIN')).toBe(cxxEnum('WriteBegin'));
    expect(asmEqu('SCF_TYPE_COMPLETE')).toBe(cxxEnum('Complete'));
    expect(SOURCE).toMatch(
      /sync_send_hello:[\s\S]*?ld \(hl\),1[\s\S]*?ld \(hl\),0x86[\s\S]*?ld \(hl\),0x0B[\s\S]*?ld \(hl\),SCF_CHUNK_BYTES/,
    );
    expect(SOURCE).toMatch(
      /sync_receive_hello_ack:[\s\S]*?SCF_TYPE_HELLO_ACK[\s\S]*?sync_hello_nonce_loop/,
    );

    const helloPayload = Buffer.from([
      1, 0x86, 0x0B, 0, 128, 0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5, 0xA6, 0xA7, 0xA8,
    ]);
    const frame = encodeScf1Frame(asmEqu('SCF_TYPE_HELLO'), 0, helloPayload);
    expect(frame.toString('hex')).toBe(
      '53434631010000000e0001860b008000a1a2a3a4a5a6a7a80328',
    );
  });

  it('exposes only the fixed sync variables and bounded immutable artifact names', () => {
    expect(asmEqu('READ_LIMIT_DSID')).toBe(512);
    expect(asmEqu('READ_LIMIT_DSINFO')).toBe(4096);
    expect(asmEqu('READ_LIMIT_DSINST')).toBe(TI86_SCHOOLCALC_LIMITS.syncManifestMaxBytes);
    expect(asmEqu('READ_LIMIT_DSQ')).toBe(TI86_SCHOOLCALC_LIMITS.queueMaxBytes);
    expect(asmEqu('READ_LIMIT_DSREQ')).toBe(TI86_SCHOOLCALC_LIMITS.deliveryRequestMaxBytes);
    expect(asmEqu('READ_LIMIT_DSTREQ')).toBe(TI86_SCHOOLCALC_LIMITS.interactionRequestMaxBytes);
    expect(asmEqu('READ_LIMIT_DSENTRY')).toBe(64);
    expect(asmEqu('WRITE_LIMIT_DSCATNEW')).toBe(TI86_SCHOOLCALC_LIMITS.catalogRecordMaxBytes);
    expect(asmEqu('WRITE_LIMIT_DSACKNEW')).toBe(TI86_SCHOOLCALC_LIMITS.acknowledgementMaxBytes);
    expect(asmEqu('WRITE_LIMIT_DSSYNC')).toBe(TI86_SCHOOLCALC_LIMITS.syncManifestMaxBytes);
    expect(asmEqu('WRITE_LIMIT_DSTNEW')).toBe(TI86_SCHOOLCALC_LIMITS.interactionResponseMaxBytes);
    expect(asmEqu('WRITE_LIMIT_DSSTDNEW')).toBe(512);
    expect(asmEqu('WRITE_LIMIT_ARTIFACT')).toBe(TI86_SCHOOLCALC_LIMITS.lessonMaxBytes);
    for (const name of [
      'DSID', 'DSINFO', 'DSINST', 'DSQ', 'DSREQ', 'DSTREQ', 'DSENTRY',
      'DSCATNEW', 'DSACKNEW', 'DSSYNC', 'DSTNEW', 'DSSTDNEW',
    ]) {
      expect(SOURCE).toContain(`defb "${name}"`);
    }
    expect(SOURCE).toMatch(
      /sync_validate_artifact_name:[\s\S]*?cp 'D'[\s\S]*?cp 'P'[\s\S]*?ld b,6[\s\S]*?cp '2'[\s\S]*?cp '7' \+ 1[\s\S]*?cp 'A'[\s\S]*?cp 'Z' \+ 1/,
    );
    expect(SOURCE).not.toMatch(/_exec_assembly|0x12,8|TI-BASIC/i);
  });

  it('bounds packet retries, contiguous offsets, and both integrity layers', () => {
    expect(asmEqu('TI_PACKET_RETRIES')).toBe(3);
    expect(SOURCE).toMatch(/ti_send_frame:[\s\S]*?TI86_MACHINE_ID[\s\S]*?TI_CMD_DATA/);
    expect(SOURCE).toMatch(/ti_receive_checksum:[\s\S]*?ti_received_checksum[\s\S]*?sbc hl,de/);
    expect(SOURCE).toMatch(/scf_send:[\s\S]*?call crc16_ccitt_false/);
    expect(SOURCE).toMatch(/scf_receive:[\s\S]*?scf_rx_expected_crc[\s\S]*?call crc16_ccitt_false/);
    expect(SOURCE).toMatch(
      /sync_handle_write_chunk:[\s\S]*?sync_transfer_offset[\s\S]*?SCF_ERROR_INVALID_OFFSET[\s\S]*?sync_crc_update/,
    );
    expect(SOURCE).toMatch(
      /sync_handle_write_end:[\s\S]*?sync_record_expected_crc[\s\S]*?sync_record_crc[\s\S]*?SCF_ERROR_RECORD_CHECKSUM/,
    );
    expect(SOURCE).toMatch(/sync_wait_ack:[\s\S]*?sync_expected_ack_offset/);
    expect(SOURCE).toMatch(
      /sync_handle_ping:[\s\S]*?ld de,8[\s\S]*?ldir[\s\S]*?SCF_TYPE_PONG[\s\S]*?ld bc,8/,
    );
  });

  it('returns the observed TI link input after a receive signal or exact edge', () => {
    const receiveWait = SOURCE.match(/link_wait_signal:[\s\S]*?link_wait_ok:[\s\S]*?ret/);
    expect(receiveWait).not.toBeNull();
    expect(receiveWait[0]).toMatch(
      /in a,\(LINK_PORT\)[\s\S]*?and 3[\s\S]*?cp LINK_INPUT_RED_LOW[\s\S]*?cp LINK_INPUT_WHITE_LOW/,
    );
    // `link_wait_exact` already leaves A equal to its observed match, and
    // `link_wait_signal` reaches this branch with its observed input in A.
    // Preserve that value while clearing carry; loading stale D corrupts the
    // first bit after an otherwise valid cable transition.
    expect(receiveWait[0]).toMatch(/link_wait_ok:[\s\S]*?and 0xff[\s\S]*?ret/);
    expect(receiveWait[0]).not.toMatch(/link_wait_ok:[\s\S]*?ld a,d/);
  });

  it('releases the physical bus and partial allocation on every terminal route', () => {
    const indicatorAt = SOURCE.indexOf('call _runindicoff');
    const disableAt = SOURCE.indexOf('\n        di\n');
    const firstPortWriteAt = SOURCE.indexOf('out (LINK_PORT),a');
    // SCHLCALC has already authenticated the immutable Program image before
    // TI-OS loads SCSYNC into mutable execution RAM. This child begins by
    // turning the run indicator off before it claims port 7.
    expect(indicatorAt).toBeGreaterThan(0);
    expect(indicatorAt).toBeLessThan(disableAt);
    expect(disableAt).toBeLessThan(firstPortWriteAt);
    expect(SOURCE).toMatch(
      /sync_release_transport:[\s\S]*?call link_release_lines[\s\S]*?ld a,0xFF[\s\S]*?out \(KEY_PORT\),a[\s\S]*?ei/,
    );
    expect(SOURCE).toMatch(
      /sync_terminal_failure:[\s\S]*?call sync_delete_partial_write[\s\S]*?call sync_release_transport/,
    );
    expect(SOURCE).toMatch(
      /sync_delete_partial_write:[\s\S]*?sync_write_active[\s\S]*?call nc,_delvar/,
    );
    expect(SOURCE).toContain('ld a,0xBF');
    expect(SOURCE).toContain('bit 6,a');
    expect(SOURCE).toContain('ld a,0xFD');
    expect(SOURCE).toContain('bit 7,a');
  });

  it('makes verified presence, direction, progress, and unplug safety visible', () => {
    for (const text of [
      'CONNECT RELAY', 'Cable: connected', 'Relay: verified', 'Sending to relay',
      'Server exchange', 'Receiving from relay', 'Keep cable connected', 'Safe to unplug',
      'Cable disconnected', 'Local data preserved',
    ]) {
      expect(SOURCE).toContain(`defb "${text}"`);
    }
    expect(SOURCE).toMatch(/sync_handle_phase:[\s\S]*?call sync_render_phase[\s\S]*?sync_send_ack/);
    expect(SOURCE).toMatch(/sync_render_progress_bar:[\s\S]*?sync_progress_width/);
    expect(SOURCE).toContain('UI_RENDER_INCLUDE_COMPACT: equ 1');
    expect(SOURCE).toContain('UI_RENDER_INCLUDE_READER: equ 0');
  });

  it('returns through the shell commit boundary without advertising an unproven capability', () => {
    expect(SHELL).toMatch(
      /launch_sync_runtime:[\s\S]*?call publish_device_info[\s\S]*?call local_state_save[\s\S]*?ld hl,scsync_name[\s\S]*?call _exec_assembly[\s\S]*?call local_state_load[\s\S]*?call sync_commit_staged[\s\S]*?call publish_device_info/,
    );
    expect(TI86_RUNTIME_MODULES.foregroundSync.capabilities).toEqual([]);
  });
});

function asmEqu(name) {
  const match = SOURCE.match(new RegExp(`^${name}:\\s+equ\\s+([^;\\n]+)`, 'm'));
  if (!match) throw new Error(`missing assembly constant ${name}`);
  const expression = match[1].trim()
    .replaceAll(/\b0x([0-9a-f]+)\b/gi, (_, hex) => String(Number.parseInt(hex, 16)));
  const value = Number(expression);
  if (!Number.isInteger(value)) throw new Error(`assembly constant ${name} is not a literal`);
  return value;
}

function cxxConstant(name) {
  const match = RELAY_WIRE.match(new RegExp(
    `static constexpr (?:size_t|uint16_t|uint8_t) ${name} = ([0-9]+);`,
  ));
  if (!match) throw new Error(`missing relay constant ${name}`);
  return Number(match[1]);
}

function cxxEnum(name) {
  const match = RELAY_WIRE.match(new RegExp(`\\b${name} = (0x[0-9A-Fa-f]+|[0-9]+),`));
  if (!match) throw new Error(`missing relay frame type ${name}`);
  return Number(match[1]);
}

function encodeScf1Frame(type, sequence, payload) {
  const frame = Buffer.alloc(10 + payload.length + 2);
  frame.write('SCF1', 0, 'ascii');
  frame[4] = type;
  frame[5] = 0;
  frame.writeUInt16LE(sequence, 6);
  frame.writeUInt16LE(payload.length, 8);
  payload.copy(frame, 10);
  frame.writeUInt16LE(crc16Ccitt(frame.subarray(0, -2)), frame.length - 2);
  return frame;
}
