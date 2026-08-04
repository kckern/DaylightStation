import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  decodeTi86DeliveryRequestRecord,
  encodeTi86DeliveryRequests,
} from '../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';
import { TI86_SCHOOLCALC_LIMITS } from '../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcLimits.mjs';
import {
  SCHOOLCALC_LOCAL_STATE_OFFSETS,
  SCHOOLCALC_LOCAL_STATE_BYTES,
} from './lib/schoolcalc-local-state.mjs';
import {
  TI86_RUNTIME_MODULES,
  inspectTi86RuntimeProgram,
} from './lib/ti86-runtime-module.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(HERE, '..');
const ROOT = path.resolve(EXTENSION, '..', '..');
const SOURCE = readFileSync(path.join(EXTENSION, 'src', 'runtime-request.asm'), 'utf8');
const STATE = readFileSync(path.join(EXTENSION, 'src', 'runtime-state.asm'), 'utf8');

describe('SCREQ durable delivery-request runtime contract', () => {
  it('builds the closed, checksummed request runtime inside its hard ceiling', () => {
    execFileSync(process.execPath, [path.join(EXTENSION, 'tools', 'build-request-runtime.mjs')], {
      cwd: ROOT,
      stdio: 'pipe',
    });
    const inspected = inspectTi86RuntimeProgram(
      readFileSync(path.join(EXTENSION, 'dist', 'SCREQ.86p')),
      TI86_RUNTIME_MODULES.deliveryRequest,
    );
    expect(inspected).toEqual(expect.objectContaining({
      id: 'delivery-request', moduleCode: 4, programName: 'SCREQ', capabilities: [],
    }));
    expect(inspected.codeByteLength).toBeLessThanOrEqual(8 * 1024);
  });

  it('shares exact state and queue bounds with the adapter contracts', () => {
    expect(equate(STATE, 'SCSTATE_RECORD_BYTES')).toBe(SCHOOLCALC_LOCAL_STATE_BYTES);
    expect(equate(STATE, 'SCSTATE_NEXT_REQUEST_ID_OFFSET'))
      .toBe(SCHOOLCALC_LOCAL_STATE_OFFSETS.nextRequestId);
    expect(equate(STATE, 'SCSTATE_DELIVERY_ACTION_OFFSET'))
      .toBe(SCHOOLCALC_LOCAL_STATE_OFFSETS.deliveryAction);
    expect(equate(STATE, 'SCSTATE_CATALOG_KEY_OFFSET'))
      .toBe(SCHOOLCALC_LOCAL_STATE_OFFSETS.catalogGenerationKey);
    expect(equate(SOURCE, 'REQ_MAX_BYTES')).toBe(TI86_SCHOOLCALC_LIMITS.deliveryRequestMaxBytes);
    expect(equate(SOURCE, 'REQ_MAX_RECORDS')).toBe(TI86_SCHOOLCALC_LIMITS.deliveryRequestMaxRecords);
  });

  it('emits the canonical fixed SCD1 install/remove byte shape', () => {
    const record = encodeTi86DeliveryRequests({
      deviceId: '86A001',
      requests: [
        { requestId: 0x030201, learnerKey: 4, action: 'install', address: 'main/general/course/unit/lesson' },
        { requestId: 0x030202, learnerKey: 9, action: 'remove', artifactId: 'sc:ti86:ABC234DEFG' },
      ],
    });
    expect(record.toString('ascii', 0, 4)).toBe('SCD1');
    expect(record[4]).toBe(1);
    expect(record[7]).toBe(6);
    expect(record.toString('ascii', 8, 14)).toBe('86A001');
    expect(record[14]).toBe(2);
    expect([...record.subarray(15, 18)]).toEqual([1, 2, 3]);
    expect([...record.subarray(18, 20)]).toEqual([4, 0]);
    expect(record[20]).toBe(1);
    const decoded = decodeTi86DeliveryRequestRecord(record);
    expect(decoded.requests).toEqual([
      expect.objectContaining({ requestId: 0x030201, learnerKey: 4, action: 'install' }),
      expect.objectContaining({ requestId: 0x030202, learnerKey: 9, action: 'remove', artifactId: 'sc:ti86:ABC234DEFG' }),
    ]);
    expect(SOURCE).toContain('req_scd1_prefix:        defb "SCD1",1,0,0');
    expect(SOURCE).toMatch(
      /req_append_install_buffer:[\s\S]{0,140}call req_append_learner_key[\s\S]{0,120}REQ_ACTION_INSTALL/,
    );
    expect(SOURCE).toMatch(
      /req_append_learner_key:[\s\S]{0,100}SCSTATE_SELECTED_LEARNER_OFFSET/,
    );
  });

  it('uses the shell-authenticated runtime boundary and recovers storage before consuming a continuation', () => {
    expect(SOURCE).toMatch(
      /request_runtime_start:[\s\S]{0,220}call scstate_load\s+jp c,req_fail_state\s+call req_load_identity\s+jp c,req_fail_identity\s+call req_recover\s+jp c,req_fail_queue\s+call req_retire_committed_batch/,
    );
    expect(SOURCE).toMatch(
      /call req_pending_action[\s\S]{0,220}call req_build_entries[\s\S]{0,120}call req_append_entries[\s\S]{0,120}call req_advance_state/,
    );
    expect(SOURCE).not.toMatch(/(?:math|chemistry|physics|geography|economics|finance)/i);
    expect(SOURCE).not.toContain('_exec_assembly');
  });

  it('uses backup-first append and advances SCL1 only after DSREQ verifies', () => {
    expect(SOURCE).toContain('req_dsq_name:     defb 0x0C,5,"DSREQ",0,0,0');
    expect(SOURCE).toContain('req_dsqb_name:    defb 0x0C,6,"DSREQB",0,0');
    expect(SOURCE).toMatch(
      /req_append_entries:[\s\S]{0,1600}call req_create_candidate[\s\S]{0,2200}call req_finish_candidate_crc[\s\S]{0,300}call req_validate_open[\s\S]{0,180}jp req_replace_from_backup/,
    );
    expect(SOURCE).toMatch(
      /request_runtime_start:[\s\S]{0,620}call req_append_entries\s+jp c,req_fail_queue\s+call req_advance_state/,
    );
    expect(SOURCE).toMatch(
      /req_replace_from_backup:[\s\S]{0,900}call req_validate_canonical\s+ret c\s+ld hl,req_dsqb_name\s+call req_delete_if_present/,
    );
  });

  it('retires only an exact whole queue acknowledged by committed SCM1', () => {
    expect(SOURCE).toMatch(
      /req_ack_queue_ready:\s+ld a,\(req_existing_count\)\s+ld b,a\s+ld a,\(req_ack_count\)\s+cp b\s+ret nz\s+call req_queue_ids_match_ack\s+ret c\s+ld hl,req_dsq_name\s+call req_delete_if_present/,
    );
    expect(SOURCE).toMatch(/req_validate_ack_ids:[\s\S]{0,900}req_queue_ids_match_ack:/);
    expect(SOURCE).toContain('ld de,47');
    expect(SOURCE).toContain('ld hl,52');
    expect(SOURCE).toContain('ld hl,18');
  });

  it('turns update into consecutive install/remove IDs and persists the successor', () => {
    expect(SOURCE).toMatch(
      /cp REQ_ACTION_UPDATE[\s\S]{0,700}call req_append_install_buffer[\s\S]{0,220}call req_increment_build_id[\s\S]{0,180}call req_append_remove_buffer/,
    );
    expect(SOURCE).toMatch(
      /req_advance_state:[\s\S]{0,500}SCSTATE_NEXT_REQUEST_ID_OFFSET[\s\S]{0,500}SCSTATE_DELIVERY_ACTION_OFFSET[\s\S]{0,260}call scstate_save/,
    );
  });
});

function equate(source, name) {
  const match = source.match(new RegExp(`^${name}:\\s+equ ([0-9]+)$`, 'm'));
  if (!match) throw new Error(`missing decimal assembly equate ${name}`);
  return Number.parseInt(match[1], 10);
}
