import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TI86_SCHOOLCALC_LIMITS } from '../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcLimits.mjs';
import { TI86_NATIVE_SNAPSHOT_MAX_BYTES } from '../../../backend/src/1_adapters/schoolcalc/ti86/Ti86NativeSnapshotCodec.mjs';
import { TI86_QUEUE_MAX_BYTES } from './lib/ti86-durable-queue.mjs';
import {
  SCHOOLCALC_LOCAL_STATE_BYTES,
  SCHOOLCALC_LOCAL_STATE_SLOTS,
} from './lib/schoolcalc-local-state.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const RELAY_HEADER = path.join(ROOT, '_extensions', 'ticalc-relay', 'firmware', 'src', 'SchoolCalcRelaySession.h');
const RELAY_MAIN = path.join(ROOT, '_extensions', 'ticalc-relay', 'firmware', 'src', 'main.cpp');

describe('TI-86 SchoolCalc resource contract', () => {
  it('charges the complete standard client and leaves an honest content target', () => {
    const limits = TI86_SCHOOLCALC_LIMITS;
    expect(limits.totalUserBytes).toBe(98_224);
    expect(limits.shellMaxBytes).toBe(9 * 1024);
    expect(limits.standardRuntimeTargetBytes).toBe(6 * 1024);
    expect(limits.standardRuntimeMaxBytes).toBe(9 * 1024);
    expect(limits.qrRuntimeTargetBytes).toBe(4 * 1024);
    expect(limits.qrRuntimeMaxBytes).toBe(6 * 1024);
    expect(limits.catalogRuntimeTargetBytes).toBe(6 * 1024);
    expect(limits.catalogRuntimeMaxBytes).toBe(8 * 1024);
    expect(limits.deliveryRuntimeTargetBytes).toBe(6 * 1024);
    expect(limits.deliveryRuntimeMaxBytes).toBe(8 * 1024);
    expect(limits.resultQueueRuntimeTargetBytes).toBe(4 * 1024);
    expect(limits.resultQueueRuntimeMaxBytes).toBe(8 * 1024);
    expect(limits.syncRuntimeTargetBytes).toBe(6 * 1024);
    expect(limits.syncRuntimeMaxBytes).toBe(8 * 1024);
    expect(limits.nativeRuntimeTargetBytes).toBe(6 * 1024);
    expect(limits.nativeRuntimeMaxBytes).toBe(8 * 1024);
    expect(limits.profileRuntimeTargetBytes).toBe(6 * 1024);
    expect(limits.profileRuntimeMaxBytes).toBe(8 * 1024);
    expect(limits.tutorRuntimeTargetBytes).toBe(6 * 1024);
    expect(limits.tutorRuntimeMaxBytes).toBe(9 * 1024);
    expect(limits.standardClientProgramCount).toBe(10);
    expect(limits.standardClientVariableOverheadBytes).toBe(320);
    expect(limits.standardClientTargetBytes).toBe(60_736);
    expect(limits.standardClientIndependentCeilingBytes).toBe(83_264);
    expect(limits.standardClientMaxBytes).toBe(71_962);
    expect(limits.catalogStateTargetBytes).toBe(3.5 * 1024);
    expect(limits.catalogStateMaxBytes).toBe(6 * 1024);
    expect(limits.localStateStorageBytes).toBe(312);
    expect(limits.catalogRecordTargetBytes).toBe(3272);
    expect(limits.catalogRecordMaxBytes).toBe(5832);
    expect(limits.catalogRecordMaxBytes + limits.localStateStorageBytes)
      .toBe(limits.catalogStateMaxBytes);
    expect(limits.queueTargetBytes).toBe(4 * 1024);
    expect(limits.queueMaxBytes).toBe(6 * 1024);
    expect(limits.queueMaxRecords).toBe(170);
    expect(limits.deliveryRequestTargetBytes).toBe(512);
    expect(limits.deliveryRequestMaxBytes).toBe(2048);
    expect(limits.deliveryRequestMaxRecords).toBe(32);
    expect(limits.learnerRosterTargetBytes).toBe(256);
    expect(limits.learnerRosterMaxBytes).toBe(512);
    expect(limits.learnerRosterMaxRecords).toBe(16);
    expect(limits.progressProjectionTargetBytes).toBe(2 * 1024);
    expect(limits.progressProjectionMaxBytes).toBe(4 * 1024);
    expect(limits.outputReceiptBytes).toBe(34);
    expect(limits.outputReceiptStorageBytes).toBe(66);
    expect(limits.acknowledgementMaxBytes).toBe(544);
    expect(limits.syncManifestMaxBytes).toBe(6 * 1024);
    expect(limits.nativeSnapshotMaxBytes).toBe(4 * 1024);
    expect(limits.freeReserveBytes).toBe(9_300);
    expect(limits.freeReserveBytes - limits.nativeSnapshotMaxBytes - limits.variableOverheadBytes)
      .toBe(5172);
    expect(limits.lessonTargetBytes).toBe(8 * 1024);
    expect(limits.lessonMaxBytes).toBe(12 * 1024);
    expect(limits.queueCommitCopyCount).toBe(0);
    expect(limits.nominalDownloadableContentBytes).toBe(16_346);
    expect(limits.downloadableContentAtStandardClientCeilingBytes).toBe(0);
    expect(limits.nominalDownloadableContentBytes)
      .toBeGreaterThan(limits.downloadableContentAtStandardClientCeilingBytes);
  });

  it('keeps calculator storage codecs aligned with the adapter limits', () => {
    expect(TI86_QUEUE_MAX_BYTES).toBe(TI86_SCHOOLCALC_LIMITS.queueMaxBytes);
    expect(SCHOOLCALC_LOCAL_STATE_BYTES).toBe(TI86_SCHOOLCALC_LIMITS.localStateRecordBytes);
    expect(SCHOOLCALC_LOCAL_STATE_SLOTS).toHaveLength(TI86_SCHOOLCALC_LIMITS.localStateSlotCount);
    expect(TI86_NATIVE_SNAPSHOT_MAX_BYTES).toBe(TI86_SCHOOLCALC_LIMITS.nativeSnapshotMaxBytes);
  });

  it('keeps the separately compiled relay on the same wire limits', () => {
    const header = readFileSync(RELAY_HEADER, 'utf8');
    expect(cxxConstant(header, 'TI86_CATALOG_RECORD_MAX_BYTES'))
      .toBe(TI86_SCHOOLCALC_LIMITS.catalogRecordMaxBytes);
    expect(cxxConstant(header, 'TI86_RESULT_QUEUE_MAX_BYTES'))
      .toBe(TI86_SCHOOLCALC_LIMITS.queueMaxBytes);
    expect(cxxConstant(header, 'TI86_DELIVERY_REQUEST_MAX_BYTES'))
      .toBe(TI86_SCHOOLCALC_LIMITS.deliveryRequestMaxBytes);
    expect(cxxConstant(header, 'TI86_LEARNER_ROSTER_MAX_BYTES'))
      .toBe(TI86_SCHOOLCALC_LIMITS.learnerRosterMaxBytes);
    expect(cxxConstant(header, 'TI86_PROGRESS_PROJECTION_MAX_BYTES'))
      .toBe(TI86_SCHOOLCALC_LIMITS.progressProjectionMaxBytes);
    expect(cxxConstant(header, 'TI86_ARTIFACT_MAX_BYTES'))
      .toBe(TI86_SCHOOLCALC_LIMITS.lessonMaxBytes);
    expect(cxxConstant(header, 'TI86_ACKNOWLEDGEMENT_MAX_BYTES'))
      .toBe(TI86_SCHOOLCALC_LIMITS.acknowledgementMaxBytes);
    expect(cxxConstant(header, 'TI86_SYNC_MANIFEST_MAX_BYTES'))
      .toBe(TI86_SCHOOLCALC_LIMITS.syncManifestMaxBytes);

    const main = readFileSync(RELAY_MAIN, 'utf8');
    expect(main).toMatch(/RESULT_QUEUE_CAPACITY\s*=\s*schoolcalc_relay::TI86_RESULT_QUEUE_MAX_BYTES/);
    expect(main).toMatch(/DELIVERY_REQUEST_CAPACITY\s*=\s*schoolcalc_relay::TI86_DELIVERY_REQUEST_MAX_BYTES/);
    expect(main).toMatch(/PROGRESS_PROJECTION_CAPACITY\s*=\s*schoolcalc_relay::TI86_PROGRESS_PROJECTION_MAX_BYTES/);
    expect(main).toMatch(/TRANSFER_CAPACITY\s*=\s*schoolcalc_relay::TI86_ARTIFACT_MAX_BYTES/);
    expect(main).toMatch(/INSTALLED_STATE_CAPACITY\s*=\s*schoolcalc_relay::TI86_SYNC_MANIFEST_MAX_BYTES/);
    expect(main).toMatch(/ACKNOWLEDGEMENT_CAPACITY\s*=\s*schoolcalc_relay::TI86_ACKNOWLEDGEMENT_MAX_BYTES/);
    expect(main).toMatch(/MANIFEST_CAPACITY\s*=\s*schoolcalc_relay::TI86_SYNC_MANIFEST_MAX_BYTES/);
  });
});

function cxxConstant(source, name) {
  const match = source.match(new RegExp(`static constexpr uint16_t ${name} = ([0-9]+);`));
  if (!match) throw new Error(`Relay constant ${name} is missing or not a decimal literal`);
  return Number(match[1]);
}
