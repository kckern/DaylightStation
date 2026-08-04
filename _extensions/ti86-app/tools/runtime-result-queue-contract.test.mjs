import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  crc16Ccitt,
  encodeTi86ResultRecord,
} from '../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';
import { TI86_SCHOOLCALC_LIMITS } from '../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcLimits.mjs';
import {
  SCHOOLCALC_LOCAL_FLAGS,
  SCHOOLCALC_LOCAL_STATE_OFFSETS,
} from './lib/schoolcalc-local-state.mjs';
import {
  TI86_RUNTIME_MODULES,
  inspectTi86RuntimeProgram,
} from './lib/ti86-runtime-module.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(HERE, '..');
const ROOT = path.resolve(EXTENSION, '..', '..');
const SOURCE = readFileSync(path.join(EXTENSION, 'src', 'runtime-result-queue.asm'), 'utf8');
const CORE = readFileSync(path.join(EXTENSION, 'src', 'runtime-queue.asm'), 'utf8');
const LEARN = readFileSync(path.join(EXTENSION, 'src', 'runtime-standard.asm'), 'utf8');
const CARDS = readFileSync(path.join(EXTENSION, 'src', 'runtime-assessment.asm'), 'utf8');

describe('SCQUEUE response/progress transaction contract', () => {
  it('builds a closed, checksummed queue writer inside its hard execution ceiling', () => {
    execFileSync(process.execPath, [path.join(EXTENSION, 'tools', 'build-result-queue-runtime.mjs')], {
      cwd: ROOT,
      stdio: 'pipe',
    });
    const inspected = inspectTi86RuntimeProgram(
      readFileSync(path.join(EXTENSION, 'dist', 'SCQUEUE.86p')),
      TI86_RUNTIME_MODULES.resultQueue,
    );
    expect(inspected).toEqual(expect.objectContaining({
      id: 'result-queue', moduleCode: 5, programName: 'SCQUEUE', capabilities: [],
    }));
    expect(inspected.codeByteLength).toBeLessThanOrEqual(
      TI86_SCHOOLCALC_LIMITS.resultQueueRuntimeMaxBytes,
    );
  });

  it('builds the exact timestamp-free SCR1 progress shape used by the adapter', () => {
    const progress = {
      schema: 'school.calc.result/v1', kind: 'progress', deviceId: '86A001',
      sequence: 0x030201, learnerKey: 4, artifactId: 'sc:ti86:ABC234DEFG', moduleIndex: 2,
      progress: { status: 'viewed', position: 4, total: 8 },
    };
    expect(buildAssemblyShapedProgress(progress).equals(encodeTi86ResultRecord(progress))).toBe(true);
    expect(CORE).toContain('QUEUE_KIND_PROGRESS:    equ 0x80');
    expect(CORE).toContain('QUEUE_DRAFT_PROGRESS:   equ 6');
    expect(`${SOURCE}\n${CORE}`).not.toMatch(/(?:timestamp|occurredAt|completedAt|receivedAt|recordedAt)/);
  });

  it('stages viewed/completed position before the fixed SCQUEUE OS call', () => {
    expect(LEARN).toMatch(
      /standard_runtime_leave_viewed:\s+ld a,2[\s\S]{0,80}standard_runtime_leave_completed:\s+ld a,3/,
    );
    expect(LEARN).toMatch(
      /standard_runtime_stage_progress:\s+ld hl,runtime_state_record \+ RUNTIME_SCL_DRAFT_OFFSET\s+ld \(hl\),a/,
    );
    expect(LEARN).toMatch(
      /standard_runtime_stage_progress:[\s\S]*?RUNTIME_VIEW_LESSON[\s\S]*?STANDARD_FLAG_RESULT_PENDING_HIGH[\s\S]*?call runtime_state_save[\s\S]*?call standard_launch_result_queue/,
    );
    expect(LEARN).toMatch(
      /standard_launch_result_queue:[\s\S]{0,180}standard_scqueue_name[\s\S]{0,180}call _exec_assembly[\s\S]{0,220}STANDARD_FLAG_RESULT_PENDING_HIGH/,
    );
    expect(CARDS).toContain('jp z,standard_runtime_leave_viewed');
    expect(CARDS).toContain('jp z,standard_runtime_leave_completed');
    expect(LEARN).not.toMatch(/sc_map_find_literal[\s\S]{0,120}_exec_assembly/);
  });

  it('clears pending state and advances sequence only after canonical DSQ verifies', () => {
    expect(CORE).toMatch(
      /result_queue_commit:[\s\S]{0,300}call queue_recover[\s\S]{0,100}call queue_append_result[\s\S]{0,100}call queue_advance_local_state/,
    );
    expect(CORE).toMatch(
      /queue_append_result:[\s\S]{0,4200}call queue_validate_open[\s\S]{0,160}jp queue_replace_from_backup/,
    );
    expect(CORE).toMatch(/queue_advance_local_state:[\s\S]{0,600}and 0xFD/);
    expect(CORE).toMatch(/queue_sequence_advanced:[\s\S]{0,2200}jp runtime_state_save/);
    expect(CORE).toMatch(
      /queue_nested_magic_loop:[\s\S]{0,220}cp 1[\s\S]{0,520}ld hl,7[\s\S]{0,180}cp QUEUE_KIND_RESPONSES[\s\S]{0,100}cp QUEUE_KIND_PROGRESS/,
    );
    expect(SCHOOLCALC_LOCAL_FLAGS.resultPending).toBe(1 << 9);
    expect(equate(CORE, 'QUEUE_MAX_BYTES')).toBe(TI86_SCHOOLCALC_LIMITS.queueMaxBytes);
    expect(SOURCE).toContain('RUNTIME_SCL_NEXT_SEQUENCE_OFFSET: equ SCSTATE_NEXT_SEQUENCE_OFFSET');
    expect(SCHOOLCALC_LOCAL_STATE_OFFSETS.nextSequence).toBe(95);
  });

  it('uses the shell-authenticated runtime boundary and accepts only its pending writer path', () => {
    expect(SOURCE).toMatch(
      /result_queue_runtime_start:[\s\S]{0,180}call scstate_load\s+ret c\s+call result_queue_commit/,
    );
    expect(SOURCE).not.toContain('_exec_assembly');
    expect(`${SOURCE}\n${CORE}`).not.toMatch(/(?:math|chemistry|physics|geography|economics|finance)/i);
  });
});

function equate(source, name) {
  const match = source.match(new RegExp(`^${name}:\\s+equ ([0-9]+)$`, 'm'));
  if (!match) throw new Error(`missing decimal assembly equate ${name}`);
  return Number.parseInt(match[1], 10);
}

function buildAssemblyShapedProgress(result) {
  const device = Buffer.from(result.deviceId, 'ascii');
  const key = Buffer.from(result.artifactId.slice('sc:ti86:'.length), 'ascii');
  const body = Buffer.concat([
    Buffer.from([0x80 | result.moduleIndex, device.length]), device,
    Buffer.from([
      result.sequence & 0xff,
      (result.sequence >>> 8) & 0xff,
      (result.sequence >>> 16) & 0xff,
    ]),
    Buffer.from([result.learnerKey & 0xff, result.learnerKey >>> 8]),
    key,
    Buffer.from([
      { started: 1, viewed: 2, completed: 3, abandoned: 4 }[result.progress.status],
      result.progress.position & 0xff,
      result.progress.position >>> 8,
      result.progress.total & 0xff,
      result.progress.total >>> 8,
    ]),
  ]);
  const bytes = Buffer.alloc(7 + body.length + 2);
  bytes.write('SCR1', 0, 4, 'ascii');
  bytes[4] = 1;
  bytes.writeUInt16LE(body.length, 5);
  body.copy(bytes, 7);
  bytes.writeUInt16LE(crc16Ccitt(bytes.subarray(0, -2)), bytes.length - 2);
  return bytes;
}
