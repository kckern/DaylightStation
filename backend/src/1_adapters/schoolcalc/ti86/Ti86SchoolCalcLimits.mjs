/**
 * Physical and product memory contract for the TI-86 SchoolCalc adapter.
 *
 * These values are calculator-family facts, so they remain in the adapter.
 * Application code receives the applicable values through a neutral device
 * capability report; it never branches on `ti86`.
 */
const totalUserBytes = 98_224;
// The shell has a 9,400-byte physical window from _asm_exec_ram ($D748) to
// video RAM ($FC00). Reserve 184 bytes at the top and enforce a 9 KiB ceiling;
// the former 8 KiB product ceiling could not represent the tenth fixed module
// in the independently verified registry.
const shellMaxBytes = 9 * 1024;
// The standard reviewed client release contains SCHLCALC, SCLEARN, SCQR,
// SCCAT, SCREQ, SCQUEUE, SCSYNC, SCNATIVE, and SCPROF.
// Each runtime has an independent build ceiling because each is loaded into
// the same bounded TI-86 assembly execution window. The aggregate target is a
// planning signal; the aggregate maximum is a release invariant.
// Optional specialized runtimes are not hidden in this allowance: installing
// one consumes reported freeBytes and therefore trades directly against
// downloadable content.
const standardRuntimeTargetBytes = 6 * 1024;
// Immediate formative feedback/retry shares SCLEARN so the generic learning
// semantics remain one reviewed runtime. Its 9 KiB ceiling is still below the
// same 9,400-byte physical execution window used by the shell; the aggregate
// release ceiling remains the stronger storage guard.
const standardRuntimeMaxBytes = 9 * 1024;
const qrRuntimeTargetBytes = 4 * 1024;
const qrRuntimeMaxBytes = 6 * 1024;
const catalogRuntimeTargetBytes = 6 * 1024;
const catalogRuntimeMaxBytes = 8 * 1024;
const deliveryRuntimeTargetBytes = 6 * 1024;
const deliveryRuntimeMaxBytes = 8 * 1024;
const resultQueueRuntimeTargetBytes = 4 * 1024;
const resultQueueRuntimeMaxBytes = 8 * 1024;
const syncRuntimeTargetBytes = 6 * 1024;
const syncRuntimeMaxBytes = 8 * 1024;
const nativeRuntimeTargetBytes = 6 * 1024;
const nativeRuntimeMaxBytes = 8 * 1024;
// Profile selection and the compact progress projection share one reviewed
// runtime so identity/progress UX can evolve without consuming shell space.
const profileRuntimeTargetBytes = 6 * 1024;
// Profile and progress deliberately share one runtime. It is constrained to
// the 8 KiB TI-OS child-program window exercised by SCPROF itself.
const profileRuntimeMaxBytes = 8 * 1024;
// Adaptive tutoring is a separate reviewed runtime. Its learner-control
// palette and durable retry state need more than the default 8 KiB runtime
// budget, but remain below the same 9 KiB product / 9,400-byte physical window
// already enforced for the shell. The aggregate client ceiling below remains
// the final storage guard, so this does not consume the protected free reserve.
const tutorRuntimeTargetBytes = 6 * 1024;
const tutorRuntimeMaxBytes = 9 * 1024;
const standardClientProgramCount = 10;
// One SCC1 snapshot is bound to a calculator. The client therefore starts at
// Subject rather than spending its 4 KiB target on an in-device Catalog chooser.
const catalogStateTargetBytes = 3.5 * 1024;
const catalogStateMaxBytes = 6 * 1024;
const queueTargetBytes = 4 * 1024;
const queueMaxBytes = 6 * 1024;
const queueMaxRecords = 170;
// Delivery intents are a separate, much smaller offline queue. A second copy
// may exist briefly while SCCAT appends or retires acknowledged requests.
const deliveryRequestTargetBytes = 512;
const deliveryRequestMaxBytes = 2 * 1024;
const deliveryRequestMaxRecords = 32;
// Active configured learners only. Historical learner-key bindings stay on the
// backend and do not consume calculator RAM; Guest is synthetic key zero.
const learnerRosterTargetBytes = 256;
const learnerRosterMaxBytes = 512;
const learnerRosterMaxRecords = 16;
// One replaceable all-learner projection. The staged DSPRGNEW copy is charged
// separately by the sync planner before it is promoted to DSPROG.
const progressProjectionTargetBytes = 2 * 1024;
const progressProjectionMaxBytes = 4 * 1024;
// At most one durable tutor/action request and one committed response are
// retained. The relay writes a second response copy under DSTNEW; the local
// runtime promotes it only after validating the complete record and request ID.
const interactionRequestTargetBytes = 256;
const interactionRequestMaxBytes = 512;
const interactionResponseTargetBytes = 1024;
const interactionResponseMaxBytes = 2 * 1024;
const variableOverheadBytes = 32;
// DSQOUT is a calculator-private, fixed SCO1 optical-output receipt map. It
// is never uploaded and cannot acknowledge DSQ; charge its String/VAT cost so
// QR self-reporting does not silently consume downloadable-content capacity.
const outputReceiptBytes = 34;
const outputReceiptStorageBytes = outputReceiptBytes + variableOverheadBytes;
// Preserve a 9.375 KiB recovery/scratch reserve after the installed client.
// The current ten-runtime release needs the remaining 640 bytes for a
// memory-safe user/profile flow; downloadable content remains independent of
// this protected reserve.
const freeReserveBytes = 9_600;
const lessonTargetBytes = 8 * 1024;
const lessonMaxBytes = 12 * 1024;
// 170 u24 sequences plus a maximum-length device ID fit in 538 bytes.
const acknowledgementMaxBytes = 544;
const syncManifestMaxBytes = 6 * 1024;
// A native handoff may temporarily store one opaque, OS-produced snapshot.
// It is charged against (and therefore bounded below) the 10 KiB free reserve;
// it is never treated as downloadable-content capacity.
const nativeSnapshotMaxBytes = 4 * 1024;
const localStateRecordBytes = 124;
const localStateSlotCount = 2;
const localStateStorageBytes = localStateSlotCount * (localStateRecordBytes + variableOverheadBytes);
const localStateCommitBytes = localStateRecordBytes + variableOverheadBytes;
const catalogRecordTargetBytes = catalogStateTargetBytes - localStateStorageBytes;
const catalogRecordMaxBytes = catalogStateMaxBytes - localStateStorageBytes;
const standardClientVariableOverheadBytes = standardClientProgramCount * variableOverheadBytes;
const standardClientTargetBytes = shellMaxBytes
  + standardRuntimeTargetBytes
  + qrRuntimeTargetBytes
  + catalogRuntimeTargetBytes
  + deliveryRuntimeTargetBytes
  + resultQueueRuntimeTargetBytes
  + syncRuntimeTargetBytes
  + nativeRuntimeTargetBytes
  + profileRuntimeTargetBytes
  + tutorRuntimeTargetBytes
  + standardClientVariableOverheadBytes;
const standardClientIndependentCeilingBytes = shellMaxBytes
  + standardRuntimeMaxBytes
  + qrRuntimeMaxBytes
  + catalogRuntimeMaxBytes
  + deliveryRuntimeMaxBytes
  + resultQueueRuntimeMaxBytes
  + syncRuntimeMaxBytes
  + nativeRuntimeMaxBytes
  + profileRuntimeMaxBytes
  + tutorRuntimeMaxBytes
  + standardClientVariableOverheadBytes;
// Per-program executable ceilings are independent compile guards, not a
// promise that all ten programs may simultaneously reach 8 KiB. Cap the
// aggregate client so maximum durable state and the emergency reserve always
// remain representable on a 98,224-byte calculator.
const standardClientMaxBytes = Math.min(
  standardClientIndependentCeilingBytes,
  totalUserBytes
    - catalogStateTargetBytes
    - queueTargetBytes
    - deliveryRequestMaxBytes
    - learnerRosterMaxBytes
    - progressProjectionMaxBytes
    - interactionRequestMaxBytes
    - interactionResponseMaxBytes
    - outputReceiptStorageBytes
    - freeReserveBytes,
);

export const TI86_SCHOOLCALC_LIMITS = Object.freeze({
  totalUserBytes,
  shellMaxBytes,
  standardRuntimeTargetBytes,
  standardRuntimeMaxBytes,
  qrRuntimeTargetBytes,
  qrRuntimeMaxBytes,
  catalogRuntimeTargetBytes,
  catalogRuntimeMaxBytes,
  deliveryRuntimeTargetBytes,
  deliveryRuntimeMaxBytes,
  resultQueueRuntimeTargetBytes,
  resultQueueRuntimeMaxBytes,
  syncRuntimeTargetBytes,
  syncRuntimeMaxBytes,
  nativeRuntimeTargetBytes,
  nativeRuntimeMaxBytes,
  profileRuntimeTargetBytes,
  profileRuntimeMaxBytes,
  tutorRuntimeTargetBytes,
  tutorRuntimeMaxBytes,
  standardClientProgramCount,
  standardClientVariableOverheadBytes,
  standardClientTargetBytes,
  standardClientMaxBytes,
  standardClientIndependentCeilingBytes,
  catalogStateTargetBytes,
  catalogStateMaxBytes,
  catalogRecordTargetBytes,
  catalogRecordMaxBytes,
  queueTargetBytes,
  queueMaxBytes,
  queueMaxRecords,
  deliveryRequestTargetBytes,
  deliveryRequestMaxBytes,
  deliveryRequestMaxRecords,
  learnerRosterTargetBytes,
  learnerRosterMaxBytes,
  learnerRosterMaxRecords,
  progressProjectionTargetBytes,
  progressProjectionMaxBytes,
  interactionRequestTargetBytes,
  interactionRequestMaxBytes,
  interactionResponseTargetBytes,
  interactionResponseMaxBytes,
  outputReceiptBytes,
  outputReceiptStorageBytes,
  freeReserveBytes,
  lessonTargetBytes,
  lessonMaxBytes,
  acknowledgementMaxBytes,
  syncManifestMaxBytes,
  nativeSnapshotMaxBytes,
  variableOverheadBytes,
  localStateRecordBytes,
  localStateSlotCount,
  localStateStorageBytes,
  localStateCommitBytes,
  // Neutral planner multipliers for this adapter's copy-on-write transaction.
  catalogCommitCopyCount: 1,
  manifestCommitCopyCount: 2,
  // Queue acknowledgement is whole-batch and deletion-only. A partial ACK
  // retains the immutable queue, so no second 6 KiB queue allocation exists.
  queueCommitCopyCount: 0,
  interactionResponseCommitCopyCount: 1,
  // Nominal buckets use the standard-runtime target and low end of the
  // documented 4–6 KiB state ranges. This is a content target, not permission
  // to consume the reserve. Reported freeBytes remains authoritative at sync.
  nominalDownloadableContentBytes: totalUserBytes
    - standardClientTargetBytes
    - catalogStateTargetBytes
    - queueTargetBytes
    - deliveryRequestTargetBytes
    - learnerRosterTargetBytes
    - progressProjectionTargetBytes
    - interactionRequestTargetBytes
    - interactionResponseTargetBytes
    - outputReceiptStorageBytes
    - freeReserveBytes,
  downloadableContentAtStandardClientCeilingBytes: totalUserBytes
    - standardClientMaxBytes
    - catalogStateTargetBytes
    - queueTargetBytes
    - deliveryRequestMaxBytes
    - learnerRosterMaxBytes
    - progressProjectionMaxBytes
    - interactionRequestMaxBytes
    - interactionResponseMaxBytes
    - outputReceiptStorageBytes
    - freeReserveBytes,
});

export default TI86_SCHOOLCALC_LIMITS;
