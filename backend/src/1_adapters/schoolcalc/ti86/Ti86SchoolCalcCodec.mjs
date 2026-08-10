import { createHash } from 'node:crypto';
import { ISchoolCalcCodec } from '#apps/school/ports/ISchoolCalcCodec.mjs';
import { validateSchoolCalcDeliveryRequest } from '#domains/school/schoolcalc/index.mjs';
import { TI86_SCHOOLCALC_LIMITS } from './Ti86SchoolCalcLimits.mjs';
import { Ti86NativeToolMapper } from './Ti86NativeToolMapper.mjs';
import { encodeTi86SchoolActionQr } from './Ti86SchoolActionQr.mjs';

const PLATFORM_ID = 'ti86';
// Relayed SchoolCalc variables share the v1 binary envelope, but the payload
// is either the generic typed document or a record-specific fixed layout.
// Artifact compiler revisions are separate: changing the projected lesson tree
// must change immutable artifact identity without needlessly changing every
// record.
const RECORD_VERSION = 1;
const ARTIFACT_CODEC_VERSION = 5;
const MAX_ENVELOPE_PAYLOAD = 0xffff;
const TI86_MAX_USER_BYTES = TI86_SCHOOLCALC_LIMITS.totalUserBytes;
const DEFAULT_MAX_ARTIFACT_BYTES = TI86_SCHOOLCALC_LIMITS.lessonMaxBytes;
const CAPABILITY = /^[a-z][a-z0-9.-]{0,63}@[1-9][0-9]*$/;
const COMPACT_DEVICE_ID = /^[A-Z0-9]{4,16}$/;
const ARTIFACT_PREFIX = 'sc:ti86:';
const ARTIFACT_KEY = /^[A-Z2-7]{10}$/;
const ARTIFACT_VARIABLE = /^DP[A-Z2-7]{6}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const MANIFEST_BLOCKER_BITS = Object.freeze({
  INSUFFICIENT_STAGING_STORAGE: 1 << 0,
  VARIABLE_NAME_COLLISION: 1 << 1,
});
const MANIFEST_BLOCKER_OTHER = 1 << 15;
const RESULT_QR_PREFIX = 'sch:r1:';
const RESULT_KIND = Object.freeze({ responses: 0, progress: 0x80 });
const RESULT_MODULE_MASK = 0x7f;
const ADAPTIVE_RESULT_MODE = 4;
const ADAPTIVE_RESULT_MAX_BYTES = 69;
const ADAPTIVE_SESSION_CODE = /^[0-9]{6}$/;
const ADAPTIVE_CARD_RATING = Object.freeze({ again: 1, hard: 2, know: 3 });
const ADAPTIVE_CARD_RATING_BY_CODE = invertNumericMap(ADAPTIVE_CARD_RATING);
const PROGRESS_STATUS = Object.freeze({ started: 1, viewed: 2, completed: 3, abandoned: 4 });
const PROGRESS_VERIFICATION = Object.freeze({ verified: 1, self_reported: 2, pending: 3 });
const PROGRESS_VERIFICATION_BY_CODE = invertNumericMap(PROGRESS_VERIFICATION);
const FOLLOW_UP_KIND = Object.freeze({
  continue: 1, next_unit: 2, next_lesson: 3, next_quiz: 4, remediation: 5, review: 6,
});
const FOLLOW_UP_KIND_BY_CODE = invertNumericMap(FOLLOW_UP_KIND);
const FOLLOW_UP_AVAILABILITY = Object.freeze({
  ready: 1, requires_connection: 2, requires_install: 3, blocked: 4,
});
const FOLLOW_UP_AVAILABILITY_BY_CODE = invertNumericMap(FOLLOW_UP_AVAILABILITY);
const PROGRESS_SCORE_NONE = 0xff;
const PROGRESS_RECENT_SCORE_LIMIT = 1;
const PROGRESS_FOLLOW_UP_LIMIT = 2;
const PROGRESS_HISTORY_NODE_LIMIT = 12;
const PROGRESS_HISTORY_TOTAL_NODE_LIMIT = 48;
const PROGRESS_HISTORY_LABEL_MAX = 20;
const PROGRESS_HISTORY_PENDING = 0x80;
const PROGRESS_HISTORY_KIND = Object.freeze({
  catalog: 1, subject: 2, course: 3, unit: 4, lesson: 5, module: 6,
});
const PROGRESS_HISTORY_KIND_BY_CODE = invertNumericMap(PROGRESS_HISTORY_KIND);
const INTERACTION_ACTION = Object.freeze({
  invoke_follow_up: 1,
  choice: 2,
  cancel: 3,
  skip: 4,
  explain: 5,
  challenge: 6,
});
const INTERACTION_ACTION_BY_CODE = invertNumericMap(INTERACTION_ACTION);
const INTERACTION_TURN_ACTIONS = new Set(['choice', 'skip', 'explain', 'challenge']);
const INTERACTION_CONTROL = Object.freeze({ stop: 1, skip: 2, explain: 4, challenge: 8 });
const INTERACTION_CONTROL_MASK = Object.values(INTERACTION_CONTROL)
  .reduce((mask, bit) => mask | bit, 0);
const INTERACTION_DISPOSITION = Object.freeze({
  complete: 1, processing: 2, unavailable: 3, retryable_error: 4,
});
const INTERACTION_DISPOSITION_BY_CODE = invertNumericMap(INTERACTION_DISPOSITION);
const REMEDIATION_STATUS = Object.freeze({
  offered: 1, active: 2, mastered: 3, improved: 4,
  exhausted: 5, cancelled: 6,
});
const REMEDIATION_STATUS_BY_CODE = invertNumericMap(REMEDIATION_STATUS);
const DELIVERY_ACTION = Object.freeze({ install: 1, remove: 2 });
const DELIVERY_ACTION_BY_CODE = Object.freeze(Object.fromEntries(
  Object.entries(DELIVERY_ACTION).map(([name, code]) => [code, name]),
));
const PROGRESS_STATUS_BY_CODE = Object.freeze(Object.fromEntries(
  Object.entries(PROGRESS_STATUS).map(([name, code]) => [code, name]),
));
const READER_PAGE_COLUMNS = 23;
const READER_PAGE_LINES = 5;
const READER_PAGE_MAX_BYTES = (READER_PAGE_COLUMNS * READER_PAGE_LINES)
  + (READER_PAGE_LINES - 1);
// An inline choice surface reserves three compact rows for its prompt, a
// visible gap, and four rows for single-column choices. Assessment prompts
// therefore paginate independently from reader prose; a long question remains
// complete, but advances through explicit prompt pages before answers appear.
const ASSESSMENT_PROMPT_PAGE_COLUMNS = 23;
const ASSESSMENT_PROMPT_PAGE_LINES = 3;
const ASSESSMENT_PROMPT_PAGE_MAX_BYTES = (ASSESSMENT_PROMPT_PAGE_COLUMNS * ASSESSMENT_PROMPT_PAGE_LINES)
  + (ASSESSMENT_PROMPT_PAGE_LINES - 1);
const ASSESSMENT_MAX_ITEMS = 48;
const LEARNING_PROBE_MAX_ITEMS = 12;
const ASSESSMENT_MAX_CHOICES = 5;
const ASSESSMENT_CHOICE_MAX_CHARS = 23;
// Catalog navigation should speak in learner-facing activities even when an
// authored pack intentionally omits a cosmetic module title. These defaults
// are adapter presentation, not subject knowledge or domain behavior.
const TI86_MODULE_FALLBACK_TITLES = Object.freeze({
  lecture_notes: 'Notes',
  examples: 'Examples',
  problems: 'Practice',
  flashcards: 'Flashcards',
  learning_probe: 'Check',
  quiz: 'Quiz',
  tool: 'Tool',
});
const READER_BLOCK_TYPES = new Set([
  'heading', 'prose', 'definition', 'formula', 'worked_example', 'callout',
]);
const ACTION_TOKEN = /^sch:[2-9A-HJ-NP-Z]{16}$/;

// Shapes this family codec can project into SCP1. This is not an installed
// device claim; production compilation always receives an observed report.
export const TI86_SCHOOLCALC_CODEC_CAPABILITIES = Object.freeze([
  'cable-sync@1',
  'calculator@1',
  'equation-editor@1',
  'examples@1',
  'flashcards@1',
  'graph@1',
  'matrix@1',
  'learning-probe@1',
  'native-program@1',
  'problems@1',
  'qr-output@1',
  'quiz@1',
  'reader@1',
  'response.choice@1',
  'scan-action@1',
  'solver@1',
  'table@1',
]);

// Capabilities honestly advertised by the current digest-pinned client. The
// Runtime-backed code remains unadvertised until emulator and fleet recovery
// gates pass; projectable codec support must never leak into DSINFO.
export const TI86_SCHOOLCALC_CLIENT_CAPABILITIES = Object.freeze([
  'shell-core@1',
]);

// DSINFO carries one independently verified bit per fixed SCX1 program. The
// calculator discovers these from installed Program variables; authored
// content cannot set them. Runtime capability promotion remains an explicit
// release gate so source-complete code is never confused with fleet proof.
export const TI86_SCHOOLCALC_RUNTIME_MODULE_BITS = Object.freeze({
  standardLearning: 1 << 0,
  resultQr: 1 << 1,
  catalogBrowser: 1 << 2,
  deliveryRequest: 1 << 3,
  resultQueue: 1 << 4,
  foregroundSync: 1 << 5,
  nativeHandoff: 1 << 6,
  learnerProfile: 1 << 7,
  realtimeTutor: 1 << 8,
});
export const TI86_SCHOOLCALC_RUNTIME_MODULE_FULL_MASK = Object.values(
  TI86_SCHOOLCALC_RUNTIME_MODULE_BITS,
).reduce((mask, bit) => mask | bit, 0);
export const TI86_SCHOOLCALC_RUNTIME_PROMOTION_ENABLED = false;

/** CRC-16/CCITT-FALSE used inside SchoolCalc variables, independent of TI link checksums. */
export function crc16Ccitt(bytes) {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = ((crc & 0x8000) !== 0) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

/** Deterministic JSON: authored array order is retained; mapping keys are sorted. */
export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

/**
 * Encode an adapter-owned variable payload using the bounded SchoolCalc binary
 * document codec. The Z80 shell never needs a JSON parser.
 */
export function encodeTi86Envelope(magic, payload) {
  if (!/^[A-Z0-9]{4}$/.test(magic)) throw new Error('TI-86 SchoolCalc envelope magic must be four ASCII characters');
  const body = encodeBinaryDocument(payload);
  if (body.length > MAX_ENVELOPE_PAYLOAD) throw new Error(`TI-86 SchoolCalc payload is too large (${body.length} bytes)`);
  const bytes = Buffer.alloc(7 + body.length + 2);
  bytes.write(magic, 0, 4, 'ascii');
  bytes[4] = RECORD_VERSION;
  bytes.writeUInt16LE(body.length, 5);
  body.copy(bytes, 7);
  bytes.writeUInt16LE(crc16Ccitt(bytes.subarray(0, -2)), bytes.length - 2);
  return bytes;
}

function encodeFixedEnvelope(magic, body) {
  if (!/^[A-Z0-9]{4}$/.test(magic)) throw new Error('TI-86 SchoolCalc envelope magic must be four ASCII characters');
  if (!Buffer.isBuffer(body) || body.length > MAX_ENVELOPE_PAYLOAD) {
    throw new Error(`TI-86 ${magic} fixed payload is too large`);
  }
  const bytes = Buffer.alloc(7 + body.length + 2);
  bytes.write(magic, 0, 4, 'ascii');
  bytes[4] = RECORD_VERSION;
  bytes.writeUInt16LE(body.length, 5);
  body.copy(bytes, 7);
  bytes.writeUInt16LE(crc16Ccitt(bytes.subarray(0, -2)), bytes.length - 2);
  return bytes;
}

function decodeFixedEnvelope(input, expectedMagic) {
  const bytes = envelopeBytes(input, expectedMagic);
  if (bytes.length < 9) throw new Error(`${expectedMagic} record is truncated`);
  if (bytes.toString('ascii', 0, 4) !== expectedMagic) throw new Error(`${expectedMagic} record has the wrong magic`);
  if (bytes[4] !== RECORD_VERSION) throw new Error(`${expectedMagic} record uses unsupported version ${bytes[4]}`);
  const bodyLength = bytes.readUInt16LE(5);
  if (bytes.length !== 7 + bodyLength + 2) throw new Error(`${expectedMagic} record length does not match its header`);
  if (bytes.readUInt16LE(bytes.length - 2) !== crc16Ccitt(bytes.subarray(0, -2))) {
    throw new Error(`${expectedMagic} record checksum failed`);
  }
  return bytes.subarray(7, -2);
}

/** Validate, checksum, and parse an adapter-owned binary-document payload. */
export function decodeTi86Envelope(input, expectedMagic) {
  const bytes = envelopeBytes(input, expectedMagic);
  if (bytes.length < 9) throw new Error(`${expectedMagic} record is truncated`);
  if (bytes.toString('ascii', 0, 4) !== expectedMagic) throw new Error(`${expectedMagic} record has the wrong magic`);
  if (bytes[4] !== RECORD_VERSION) throw new Error(`${expectedMagic} record uses unsupported version ${bytes[4]}`);
  const bodyLength = bytes.readUInt16LE(5);
  if (bytes.length !== 7 + bodyLength + 2) throw new Error(`${expectedMagic} record length does not match its header`);
  const expectedCrc = bytes.readUInt16LE(bytes.length - 2);
  const actualCrc = crc16Ccitt(bytes.subarray(0, -2));
  if (actualCrc !== expectedCrc) throw new Error(`${expectedMagic} record checksum failed`);
  return decodeBinaryDocument(bytes.subarray(7, 7 + bodyLength), expectedMagic);
}

/**
 * Encode the exact compact record queued by the calculator.
 *
 * Cable sends these bytes directly. QR uses BASE32 so the large record segment
 * stays in QR alphanumeric mode behind the house-wide lowercase `sch:` prefix.
 */
export function encodeTi86ResultRecord(result, { qrText = false } = {}) {
  const bytes = encodeCompactResultRecord(result);
  return qrText ? `${RESULT_QR_PREFIX}${base32(bytes)}` : bytes;
}

/** Test/tooling helper for the calculator's DSINFO variable. */
export function encodeTi86DeviceInfo(info) {
  return encodeTi86Envelope('SCI1', { schema: 'school.calc.device-info/v1', ...info });
}

/** Durable calculator-owned six-digit resolution claim (`DSENTRY`/`SCE1`). */
export function encodeTi86StudyEntry({ deviceId, requestId, sixDigitCode } = {}) {
  if (!COMPACT_DEVICE_ID.test(deviceId || '')) throw new Error('SCE1 entry has an invalid deviceId');
  if (!Number.isSafeInteger(requestId) || requestId < 0 || requestId > 0xff_ffff) {
    throw new Error('SCE1 entry has an invalid 24-bit requestId');
  }
  if (!ADAPTIVE_SESSION_CODE.test(sixDigitCode || '')) {
    throw new Error('SCE1 entry has an invalid six-digit code');
  }
  const body = [];
  pushShortAscii(body, deviceId, 'deviceId');
  pushU24(body, requestId);
  body.push(...Buffer.from(sixDigitCode, 'ascii'));
  return encodeFixedEnvelope('SCE1', Buffer.from(body));
}

export function decodeTi86StudyEntry(record) {
  const reader = new FixedRecordReader(decodeFixedEnvelope(record, 'SCE1'), 'SCE1');
  const deviceId = reader.shortAscii('deviceId');
  const requestId = reader.u24('requestId');
  const sixDigitCode = reader.fixedAscii(6, 'sixDigitCode');
  reader.done();
  if (!COMPACT_DEVICE_ID.test(deviceId)) throw new Error('SCE1 entry has an invalid deviceId');
  if (!ADAPTIVE_SESSION_CODE.test(sixDigitCode)) throw new Error('SCE1 entry has an invalid six-digit code');
  return Object.freeze({
    schema: 'school.calc.study-entry/v1', deviceId, requestId, sixDigitCode,
  });
}

/** Canonical device-bound Adaptive Study prescription (`DSSTUDY`/`DSSTDNEW`). */
export function encodeTi86StudyPrescription(prescription) {
  validateStudyPrescription(prescription);
  const body = [];
  pushShortAscii(body, prescription.deviceId, 'SCSP deviceId');
  pushU24(body, prescription.requestId);
  body.push(...Buffer.from(prescription.sessionCode, 'ascii'));
  pushShortAscii(body, prescription.prescriptionId, 'SCSP prescriptionId');
  pushShortAscii(body, prescription.studySessionId, 'SCSP studySessionId');
  pushU16(body, prescription.learnerKey);
  pushShortAscii(body, prescription.artifactId, 'SCSP artifactId');
  pushShortAscii(body, prescription.artifactVariableName, 'SCSP artifactVariableName');
  pushU16(body, prescription.artifactByteLength);
  body.push(...Buffer.from(prescription.artifactDigest, 'hex'));
  body.push(
    prescription.requiredClientVersion,
    prescription.cardCount,
    prescription.itemCount,
    prescription.maxExposuresPerCard,
    prescription.passingPercent,
  );
  pushShortAscii(body, prescription.bankRevision, 'SCSP bankRevision');
  return encodeFixedEnvelope('SCSP', Buffer.from(body));
}

export function decodeTi86StudyPrescription(record) {
  const reader = new FixedRecordReader(decodeFixedEnvelope(record, 'SCSP'), 'SCSP');
  const prescription = {
    schema: 'school.calc.study-prescription/v1',
    deviceId: reader.shortAscii('deviceId'),
    requestId: reader.u24('requestId'),
    sessionCode: reader.fixedAscii(6, 'sessionCode'),
    prescriptionId: reader.shortAscii('prescriptionId'),
    studySessionId: reader.shortAscii('studySessionId'),
    learnerKey: reader.u16('learnerKey'),
    artifactId: reader.shortAscii('artifactId'),
    artifactVariableName: reader.shortAscii('artifactVariableName'),
    artifactByteLength: reader.u16('artifactByteLength'),
    artifactDigest: reader.take(32, 'artifactDigest').toString('hex'),
    requiredClientVersion: reader.u8('requiredClientVersion'),
    cardCount: reader.u8('cardCount'),
    itemCount: reader.u8('itemCount'),
    maxExposuresPerCard: reader.u8('maxExposuresPerCard'),
    passingPercent: reader.u8('passingPercent'),
    bankRevision: reader.shortAscii('bankRevision'),
  };
  reader.done();
  validateStudyPrescription(prescription);
  return Object.freeze(prescription);
}

/** Final DSSYNC acknowledgement for one staged Adaptive Study transaction. */
export function encodeTi86StudyAcknowledgement(value) {
  if (!value || value.schema !== 'school.calc.study-acknowledgement/v1'
      || !COMPACT_DEVICE_ID.test(value.deviceId || '')
      || !Number.isInteger(value.requestId) || value.requestId < 0 || value.requestId > 0xff_ffff
      || !ADAPTIVE_SESSION_CODE.test(value.sessionCode || '')
      || !shortAscii(value.prescriptionId) || !shortAscii(value.artifactId)
      || !/^[0-9a-f]{64}$/.test(value.prescriptionDigest || '')) {
    throw new Error('SCSA study acknowledgement is invalid');
  }
  const body = [];
  pushShortAscii(body, value.deviceId, 'SCSA deviceId');
  pushU24(body, value.requestId);
  body.push(...Buffer.from(value.sessionCode, 'ascii'));
  pushShortAscii(body, value.prescriptionId, 'SCSA prescriptionId');
  pushShortAscii(body, value.artifactId, 'SCSA artifactId');
  body.push(...Buffer.from(value.prescriptionDigest, 'hex'));
  return encodeFixedEnvelope('SCSA', Buffer.from(body));
}

export function decodeTi86StudyAcknowledgement(record) {
  const reader = new FixedRecordReader(decodeFixedEnvelope(record, 'SCSA'), 'SCSA');
  const value = {
    schema: 'school.calc.study-acknowledgement/v1',
    deviceId: reader.shortAscii('deviceId'), requestId: reader.u24('requestId'),
    sessionCode: reader.fixedAscii(6, 'sessionCode'),
    prescriptionId: reader.shortAscii('prescriptionId'),
    artifactId: reader.shortAscii('artifactId'),
    prescriptionDigest: reader.take(32, 'prescriptionDigest').toString('hex'),
  };
  reader.done();
  // The encoder is the single structural validator for this compact record.
  encodeTi86StudyAcknowledgement(value);
  return Object.freeze(value);
}

function validateStudyPrescription(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || value.schema !== 'school.calc.study-prescription/v1'
      || !COMPACT_DEVICE_ID.test(value.deviceId || '')
      || !Number.isInteger(value.requestId) || value.requestId < 0 || value.requestId > 0xff_ffff
      || !ADAPTIVE_SESSION_CODE.test(value.sessionCode || '')
      || !shortAscii(value.prescriptionId) || !shortAscii(value.studySessionId)
      || !Number.isInteger(value.learnerKey) || value.learnerKey < 1 || value.learnerKey > 0xffff
      || !shortAscii(value.artifactId) || !/^[A-Z][A-Z0-9]{0,7}$/.test(value.artifactVariableName || '')
      || !Number.isInteger(value.artifactByteLength) || value.artifactByteLength < 1 || value.artifactByteLength > 0xffff
      || !/^[0-9a-f]{64}$/.test(value.artifactDigest || '')
      || !Number.isInteger(value.requiredClientVersion) || value.requiredClientVersion < 1 || value.requiredClientVersion > 255
      || !Number.isInteger(value.cardCount) || value.cardCount < 1 || value.cardCount > 12
      || !Number.isInteger(value.itemCount) || value.itemCount < 1 || value.itemCount > value.cardCount
      || !Number.isInteger(value.maxExposuresPerCard) || value.maxExposuresPerCard < 1 || value.maxExposuresPerCard > 4
      || !Number.isInteger(value.passingPercent) || value.passingPercent < 0 || value.passingPercent > 100
      || !shortAscii(value.bankRevision)) {
    throw new Error('SCSP study prescription is invalid');
  }
}

function shortAscii(value) {
  if (typeof value !== 'string') return false;
  const bytes = Buffer.from(value, 'ascii');
  return bytes.length > 0 && bytes.length <= 255 && bytes.toString('ascii') === value;
}

/** Compact key stored by SCL1 so a committed Catalog generation is bounded. */
export function ti86GenerationKey(generation) {
  if (typeof generation !== 'string' || !generation) throw new Error('TI-86 generation must be non-empty text');
  return base32(createHash('sha256').update(generation).digest()).slice(0, 10);
}

/** Decode the complete committed install snapshot carried by DSINST/SCM1. */
export function decodeTi86InstalledState(record) {
  const decoded = decodeTi86SyncManifest(record);
  return {
    deviceId: decoded.deviceId,
    generationKey: decoded.generationKey,
    catalogGenerationKey: decoded.catalogGenerationKey,
    installedArtifacts: decoded.installedArtifacts,
  };
}

/** Decode the active profile roster staged as DSUSERS. */
export function decodeTi86LearnerRoster(record) {
  const bytes = envelopeBytes(record, 'SCU1');
  if (bytes.length > TI86_SCHOOLCALC_LIMITS.learnerRosterMaxBytes) {
    throw new Error(`SCU1 learner roster exceeds ${TI86_SCHOOLCALC_LIMITS.learnerRosterMaxBytes}-byte TI-86 limit`);
  }
  const reader = new FixedRecordReader(decodeFixedEnvelope(bytes, 'SCU1'), 'SCU1');
  const deviceId = reader.shortAscii('deviceId');
  if (!COMPACT_DEVICE_ID.test(deviceId)) throw new Error('SCU1 learner roster has an invalid deviceId');
  const generationKey = reader.fixedAscii(10, 'generation key');
  if (!ARTIFACT_KEY.test(generationKey)) throw new Error('SCU1 learner roster has an invalid generation key');
  const count = reader.u8('learner count');
  if (count > TI86_SCHOOLCALC_LIMITS.learnerRosterMaxRecords) {
    throw new Error(`SCU1 learner roster exceeds ${TI86_SCHOOLCALC_LIMITS.learnerRosterMaxRecords}-learner TI-86 limit`);
  }
  const keys = new Set();
  const profiles = [];
  for (let index = 0; index < count; index += 1) {
    const learnerKey = reader.u16(`learner ${index} key`);
    if (learnerKey === 0 || keys.has(learnerKey)) throw new Error('SCU1 learner roster has an invalid or repeated learner key');
    keys.add(learnerKey);
    profiles.push(Object.freeze({ learnerKey, label: reader.shortAscii(`learner ${index} label`) }));
  }
  reader.done();
  return Object.freeze({
    schema: 'school.calc.learner-roster/v1', deviceId, generationKey,
    profiles: Object.freeze(profiles),
  });
}

/** Decode the compact per-profile progress projection staged as DSPROG. */
export function decodeTi86ProgressProjection(record) {
  const bytes = envelopeBytes(record, 'SCG1');
  if (bytes.length > TI86_SCHOOLCALC_LIMITS.progressProjectionMaxBytes) {
    throw new Error(`SCG1 progress projection exceeds ${TI86_SCHOOLCALC_LIMITS.progressProjectionMaxBytes}-byte TI-86 limit`);
  }
  const reader = new FixedRecordReader(decodeFixedEnvelope(bytes, 'SCG1'), 'SCG1');
  const deviceId = reader.shortAscii('deviceId');
  if (!COMPACT_DEVICE_ID.test(deviceId)) throw new Error('SCG1 progress projection has an invalid deviceId');
  const generationKey = reader.fixedAscii(10, 'generation key');
  if (!ARTIFACT_KEY.test(generationKey)) throw new Error('SCG1 progress projection has an invalid generation key');
  const count = reader.u8('profile count');
  if (count > TI86_SCHOOLCALC_LIMITS.learnerRosterMaxRecords) {
    throw new Error(`SCG1 progress projection exceeds ${TI86_SCHOOLCALC_LIMITS.learnerRosterMaxRecords}-profile TI-86 limit`);
  }
  const keys = new Set();
  const profiles = [];
  for (let index = 0; index < count; index += 1) {
    const learnerKey = reader.u16(`profile ${index} learner key`);
    if (learnerKey === 0 || keys.has(learnerKey)) {
      throw new Error('SCG1 progress projection has an invalid or repeated learner key');
    }
    keys.add(learnerKey);
    const summary = {
      evidenceCount: reader.u32(`profile ${index} evidence count`),
      engagementCount: reader.u32(`profile ${index} engagement count`),
      responseCount: reader.u32(`profile ${index} response count`),
      correctCount: reader.u32(`profile ${index} correct count`),
      completionCount: reader.u32(`profile ${index} completion count`),
      activityCount: reader.u32(`profile ${index} activity count`),
      assessmentCount: reader.u32(`profile ${index} assessment count`),
    };
    const score = reader.u8(`profile ${index} score percent`);
    summary.scorePercent = score === PROGRESS_SCORE_NONE ? null : score;
    summary.lastActivityOn = readDate(reader.fixedAscii(10, `profile ${index} last activity date`));
    validateDecodedProgressSummary(summary);

    const recentCount = reader.u8(`profile ${index} recent-score count`);
    if (recentCount > PROGRESS_RECENT_SCORE_LIMIT) throw new Error('SCG1 progress projection has too many recent scores');
    const recentScores = [];
    for (let recentIndex = 0; recentIndex < recentCount; recentIndex += 1) {
      const correct = reader.u16(`profile ${index} recent score ${recentIndex} correct`);
      const total = reader.u16(`profile ${index} recent score ${recentIndex} total`);
      const percent = reader.u8(`profile ${index} recent score ${recentIndex} percent`);
      const verification = PROGRESS_VERIFICATION_BY_CODE[
        reader.u8(`profile ${index} recent score ${recentIndex} verification`)
      ];
      const occurredOn = readDate(reader.fixedAscii(10, `profile ${index} recent score ${recentIndex} date`));
      const activityKind = reader.shortAscii(`profile ${index} recent score ${recentIndex} activity kind`);
      if (!verification || occurredOn === null || total === 0 || correct > total
          || percent !== Math.round((correct / total) * 100)) {
        throw new Error('SCG1 progress projection has an invalid recent score');
      }
      recentScores.push(Object.freeze({ correct, total, percent, verification, occurredOn, activityKind }));
    }

    const followUpCount = reader.u8(`profile ${index} follow-up count`);
    if (followUpCount > PROGRESS_FOLLOW_UP_LIMIT) throw new Error('SCG1 progress projection has too many follow-ups');
    const followUps = [];
    for (let followUpIndex = 0; followUpIndex < followUpCount; followUpIndex += 1) {
      const actionKey = reader.fixedAscii(10, `profile ${index} follow-up ${followUpIndex} action key`);
      const kind = FOLLOW_UP_KIND_BY_CODE[reader.u8(`profile ${index} follow-up ${followUpIndex} kind`)];
      const availability = FOLLOW_UP_AVAILABILITY_BY_CODE[
        reader.u8(`profile ${index} follow-up ${followUpIndex} availability`)
      ];
      const priority = reader.u16(`profile ${index} follow-up ${followUpIndex} priority`);
      const label = reader.shortAscii(`profile ${index} follow-up ${followUpIndex} label`);
      if (!ARTIFACT_KEY.test(actionKey) || !kind || !availability || priority > 1000 || !label) {
        throw new Error('SCG1 progress projection has an invalid follow-up');
      }
      followUps.push(Object.freeze({ actionKey, kind, availability, priority, label }));
    }
    const historyCount = reader.u8(`profile ${index} curriculum-history count`);
    if (historyCount > PROGRESS_HISTORY_NODE_LIMIT) {
      throw new Error('SCG1 progress projection has too many curriculum-history nodes');
    }
    const historyNodes = [];
    for (let historyIndex = 0; historyIndex < historyCount; historyIndex += 1) {
      const encodedParent = reader.u8(`profile ${index} history node ${historyIndex} parent`);
      const parentIndex = encodedParent === 0xff ? null : encodedParent;
      const encodedKind = reader.u8(`profile ${index} history node ${historyIndex} kind`);
      const kind = PROGRESS_HISTORY_KIND_BY_CODE[encodedKind & 0x0f];
      const pending = Boolean(encodedKind & PROGRESS_HISTORY_PENDING);
      const score = reader.u8(`profile ${index} history node ${historyIndex} score`);
      const activityCount = reader.u16(`profile ${index} history node ${historyIndex} activity count`);
      const completionCount = reader.u16(`profile ${index} history node ${historyIndex} completion count`);
      const label = reader.shortAscii(`profile ${index} history node ${historyIndex} label`);
      if ((parentIndex !== null && parentIndex >= historyIndex) || !kind
          || (encodedKind & 0x70) !== 0 || (score > 100 && score !== PROGRESS_SCORE_NONE)
          || !label) {
        throw new Error('SCG1 progress projection has an invalid curriculum-history node');
      }
      historyNodes.push(Object.freeze({
        parentIndex, kind, label, pending, activityCount, completionCount,
        scorePercent: score === PROGRESS_SCORE_NONE ? null : score,
      }));
    }
    profiles.push(Object.freeze({
      learnerKey,
      summary: Object.freeze(summary),
      recentScores: Object.freeze(recentScores),
      followUps: Object.freeze(followUps),
      curriculumHistory: Object.freeze({ nodes: Object.freeze(historyNodes) }),
    }));
  }
  reader.done();
  return Object.freeze({
    schema: 'school.calc.progress-projection/v1', deviceId, generationKey,
    profiles: Object.freeze(profiles),
  });
}

/** Test/tooling encoder for the single durable calculator interaction request. */
export function encodeTi86InteractionRequest(raw) {
  const actionCode = INTERACTION_ACTION[raw?.action];
  if (raw?.schema !== undefined && raw.schema !== 'school.calc.interaction-request/v1') {
    throw new Error('SCTQ interaction request has an invalid schema');
  }
  if (!COMPACT_DEVICE_ID.test(raw?.deviceId || '')
      || !Number.isInteger(raw?.learnerKey) || raw.learnerKey < 1 || raw.learnerKey > 0xffff
      || !Number.isInteger(raw?.requestId) || raw.requestId < 0 || raw.requestId > 0xff_ffff
      || !Number.isInteger(raw?.clientSequence) || raw.clientSequence < 0 || raw.clientSequence > 0xffff
      || !Number.isInteger(raw?.lastServerSequence) || raw.lastServerSequence < 0
      || raw.lastServerSequence > 0xffff || !actionCode) {
    throw new Error('SCTQ interaction request is invalid');
  }
  const body = [];
  pushShortAscii(body, raw.deviceId, 'interaction deviceId');
  pushU16(body, raw.learnerKey);
  pushU24(body, raw.requestId);
  body.push(actionCode);
  pushU16(body, raw.clientSequence);
  pushU16(body, raw.lastServerSequence);
  if (raw.action === 'invoke_follow_up') {
    if (!ARTIFACT_KEY.test(raw.actionKey || '')) {
      throw new Error('SCTQ invoke request has an invalid actionKey');
    }
    pushShortAscii(body, raw.actionKey, 'interaction actionKey');
  } else {
    assertInteractionLocator(raw.sessionId, 'sessionId');
    pushShortAscii(body, raw.sessionId, 'interaction sessionId');
    if (INTERACTION_TURN_ACTIONS.has(raw.action)) {
      assertInteractionLocator(raw.turnId, 'turnId');
      pushShortAscii(body, raw.turnId, 'interaction turnId');
    }
    if (raw.action === 'choice') {
      if (!/^[A-E]$/.test(raw.choiceId || '')) {
        throw new Error('SCTQ choice request requires choiceId A-E');
      }
      body.push(raw.choiceId.charCodeAt(0) - 64);
    } else if (raw.choiceId !== undefined && raw.choiceId !== null) {
      throw new Error(`SCTQ ${raw.action} request must not include choiceId`);
    }
  }
  const record = encodeFixedEnvelope('SCTQ', Buffer.from(body));
  if (record.length > TI86_SCHOOLCALC_LIMITS.interactionRequestMaxBytes) {
    throw new Error(`SCTQ interaction request exceeds ${TI86_SCHOOLCALC_LIMITS.interactionRequestMaxBytes}-byte TI-86 limit`);
  }
  return record;
}

/** Decode the one retryable interaction request retained as DSTREQ. */
export function decodeTi86InteractionRequest(record) {
  const bytes = envelopeBytes(record, 'SCTQ');
  if (bytes.length > TI86_SCHOOLCALC_LIMITS.interactionRequestMaxBytes) {
    throw new Error(`SCTQ interaction request exceeds ${TI86_SCHOOLCALC_LIMITS.interactionRequestMaxBytes}-byte TI-86 limit`);
  }
  const reader = new FixedRecordReader(decodeFixedEnvelope(bytes, 'SCTQ'), 'SCTQ');
  const deviceId = reader.shortAscii('deviceId');
  const learnerKey = reader.u16('learnerKey');
  const requestId = reader.u24('requestId');
  const action = INTERACTION_ACTION_BY_CODE[reader.u8('action')];
  const clientSequence = reader.u16('clientSequence');
  const lastServerSequence = reader.u16('lastServerSequence');
  if (!COMPACT_DEVICE_ID.test(deviceId) || learnerKey === 0 || !action) {
    throw new Error('SCTQ interaction request has invalid identity or action');
  }
  const request = {
    schema: 'school.calc.interaction-request/v1', deviceId, learnerKey,
    requestId, action, clientSequence, lastServerSequence,
  };
  if (action === 'invoke_follow_up') {
    request.actionKey = reader.shortAscii('actionKey');
    if (!ARTIFACT_KEY.test(request.actionKey)) throw new Error('SCTQ interaction request has an invalid actionKey');
  } else {
    request.sessionId = reader.shortAscii('sessionId');
    assertInteractionLocator(request.sessionId, 'sessionId');
    if (INTERACTION_TURN_ACTIONS.has(action)) {
      request.turnId = reader.shortAscii('turnId');
      assertInteractionLocator(request.turnId, 'turnId');
    }
    if (action === 'choice') {
      const choice = reader.u8('choiceId');
      if (choice < 1 || choice > 5) throw new Error('SCTQ interaction request has an invalid choiceId');
      request.choiceId = String.fromCharCode(64 + choice);
    }
  }
  reader.done();
  return Object.freeze(request);
}

/** Encode a bounded client-safe tutor/action response for DSTNEW/DSTURN. */
export function encodeTi86InteractionResponse(response) {
  const disposition = INTERACTION_DISPOSITION[response?.status];
  const expectedFlags = {
    complete: [true, false], processing: [false, true],
    unavailable: [true, false], retryable_error: [false, true],
  }[response?.status];
  if (response?.schema !== 'school.calc.interaction-response/v1'
      || !COMPACT_DEVICE_ID.test(response.deviceId || '')
      || !Number.isInteger(response.learnerKey) || response.learnerKey < 1 || response.learnerKey > 0xffff
      || !Number.isInteger(response.requestId) || response.requestId < 0 || response.requestId > 0xff_ffff
      || !disposition || response.acknowledgeRequest !== expectedFlags?.[0]
      || response.retryable !== expectedFlags?.[1]) {
    throw new Error('SCTR interaction response is invalid');
  }
  const body = [];
  pushShortAscii(body, response.deviceId, 'interaction response deviceId');
  pushU16(body, response.learnerKey);
  pushU24(body, response.requestId);
  body.push(disposition);
  pushShortInteractionText(body, response.message ?? interactionDefaultMessage(response.status), 240, 'message');
  const session = response.session ?? null;
  body.push(session ? 1 : 0);
  if (session) pushTi86InteractionSession(body, session, response.answer ?? null);
  const record = encodeFixedEnvelope('SCTR', Buffer.from(body));
  if (record.length > TI86_SCHOOLCALC_LIMITS.interactionResponseMaxBytes) {
    throw new Error(`SCTR interaction response exceeds ${TI86_SCHOOLCALC_LIMITS.interactionResponseMaxBytes}-byte TI-86 limit`);
  }
  return record;
}

/** Decode SCTR for tooling/emulator assertions; no server answer is present. */
export function decodeTi86InteractionResponse(record) {
  const bytes = envelopeBytes(record, 'SCTR');
  if (bytes.length > TI86_SCHOOLCALC_LIMITS.interactionResponseMaxBytes) {
    throw new Error(`SCTR interaction response exceeds ${TI86_SCHOOLCALC_LIMITS.interactionResponseMaxBytes}-byte TI-86 limit`);
  }
  const reader = new FixedRecordReader(decodeFixedEnvelope(bytes, 'SCTR'), 'SCTR');
  const deviceId = reader.shortAscii('deviceId');
  const learnerKey = reader.u16('learnerKey');
  const requestId = reader.u24('requestId');
  const status = INTERACTION_DISPOSITION_BY_CODE[reader.u8('status')];
  const message = readInteractionText(reader, reader.u8('message length'), 'message');
  if (!COMPACT_DEVICE_ID.test(deviceId) || learnerKey === 0 || !status) {
    throw new Error('SCTR interaction response has invalid identity or status');
  }
  const hasSession = reader.u8('session presence');
  if (hasSession > 1) throw new Error('SCTR interaction response has invalid session presence');
  const session = hasSession ? readTi86InteractionSession(reader) : null;
  reader.done();
  const [acknowledgeRequest, retryable] = {
    complete: [true, false], processing: [false, true],
    unavailable: [true, false], retryable_error: [false, true],
  }[status];
  return Object.freeze({
    schema: 'school.calc.interaction-response/v1', deviceId, learnerKey, requestId,
    status, acknowledgeRequest, retryable, message,
    ...(session ? { session } : {}),
  });
}

/** Test/tooling helper for a calculator-owned delivery-request variable. */
export function encodeTi86DeliveryRequests({ deviceId, requests }) {
  if (!COMPACT_DEVICE_ID.test(deviceId || '')) throw new Error('SCD1 request queue has an invalid deviceId');
  if (!Array.isArray(requests)
      || requests.length > TI86_SCHOOLCALC_LIMITS.deliveryRequestMaxRecords) {
    throw new Error(`SCD1 request queue exceeds ${TI86_SCHOOLCALC_LIMITS.deliveryRequestMaxRecords}-record TI-86 limit`);
  }
  const body = [];
  pushShortAscii(body, deviceId, 'deviceId');
  body.push(requests.length);
  const requestIds = [];
  for (const [index, raw] of requests.entries()) {
    const candidate = { ...raw, schema: 'school.calc.delivery-request/v1', deviceId };
    const validation = validateSchoolCalcDeliveryRequest(candidate);
    if (validation.errors.length) {
      throw new Error(`TI-86 delivery request ${index} is invalid: ${validation.errors.join('; ')}`);
    }
    if (candidate.requestId > 0xff_ffff) {
      throw new Error(`TI-86 delivery request ${index} exceeds the 24-bit requestId limit`);
    }
    if (candidate.action === 'install' && !candidate.address) {
      throw new Error(`TI-86 delivery request ${index} supports one lesson address per request`);
    }
    if (candidate.action === 'remove' && !candidate.artifactId) {
      throw new Error(`TI-86 delivery request ${index} supports one artifact per request`);
    }
    requestIds.push(candidate.requestId);
    pushU24(body, candidate.requestId);
    pushU16(body, candidate.learnerKey);
    body.push(DELIVERY_ACTION[candidate.action]);
    const target = candidate.action === 'install'
      ? candidate.address
      : artifactKey(candidate.artifactId);
    if (candidate.action === 'remove' && !target) {
      throw new Error(`TI-86 delivery request ${index} has an invalid artifactId`);
    }
    pushShortAscii(body, target, `delivery request ${index} target`);
  }
  assertStrictlyIncreasing(requestIds, 'SCD1 request queue');
  const record = encodeFixedEnvelope('SCD1', Buffer.from(body));
  if (record.length > TI86_SCHOOLCALC_LIMITS.deliveryRequestMaxBytes) {
    throw new Error(`SCD1 request queue exceeds ${TI86_SCHOOLCALC_LIMITS.deliveryRequestMaxBytes}-byte TI-86 limit`);
  }
  return record;
}

/** Decode the fixed-layout install/remove queue retained by the calculator. */
export function decodeTi86DeliveryRequestRecord(record) {
  const bytes = envelopeBytes(record, 'SCD1');
  if (bytes.length > TI86_SCHOOLCALC_LIMITS.deliveryRequestMaxBytes) {
    throw new Error(`SCD1 request queue exceeds ${TI86_SCHOOLCALC_LIMITS.deliveryRequestMaxBytes}-byte TI-86 limit`);
  }
  const reader = new FixedRecordReader(decodeFixedEnvelope(bytes, 'SCD1'), 'SCD1');
  const deviceId = reader.shortAscii('deviceId');
  if (!COMPACT_DEVICE_ID.test(deviceId)) throw new Error('SCD1 request queue has an invalid deviceId');
  const count = reader.u8('request count');
  if (count > TI86_SCHOOLCALC_LIMITS.deliveryRequestMaxRecords) {
    throw new Error(`SCD1 request queue exceeds ${TI86_SCHOOLCALC_LIMITS.deliveryRequestMaxRecords}-record TI-86 limit`);
  }
  const requests = [];
  for (let index = 0; index < count; index += 1) {
    const requestId = reader.u24(`request ${index} ID`);
    const learnerKey = reader.u16(`request ${index} learner key`);
    const action = DELIVERY_ACTION_BY_CODE[reader.u8(`request ${index} action`)];
    if (!action) throw new Error(`SCD1 request ${index} has an unknown action`);
    const target = reader.shortAscii(`request ${index} target`);
    const candidate = {
      schema: 'school.calc.delivery-request/v1',
      deviceId,
      requestId,
      learnerKey,
      action,
      ...(action === 'install'
        ? { address: target }
        : { artifactId: `${ARTIFACT_PREFIX}${target}` }),
    };
    const validation = validateSchoolCalcDeliveryRequest(candidate);
    if (validation.errors.length || (action === 'remove' && !ARTIFACT_KEY.test(target))) {
      throw new Error(`SCD1 request ${index} is invalid${validation.errors.length ? `: ${validation.errors.join('; ')}` : ''}`);
    }
    requests.push(validation.request);
  }
  reader.done();
  assertStrictlyIncreasing(requests.map((request) => request.requestId), 'SCD1 request queue');
  return Object.freeze({ deviceId, requests: Object.freeze(requests) });
}

/** Test/tooling helper for the calculator's exact-record result queue. */
export function encodeTi86ResultQueue({ deviceId, records }) {
  if (!COMPACT_DEVICE_ID.test(deviceId || '')) throw new Error('SCQ1 queue has an invalid deviceId');
  if (!Array.isArray(records) || records.length > TI86_SCHOOLCALC_LIMITS.queueMaxRecords) {
    throw new Error(`SCQ1 queue exceeds ${TI86_SCHOOLCALC_LIMITS.queueMaxRecords}-record TI-86 limit`);
  }
  const body = [];
  pushShortAscii(body, deviceId, 'deviceId');
  pushU16(body, records.length);
  for (const [index, record] of records.entries()) {
    const exact = Buffer.from(compactResultBytes(record));
    const result = decodeCompactResultRecord(exact);
    if (result.deviceId !== deviceId) throw new Error(`SCQ1 queue entry ${index} belongs to another device`);
    if (exact.length > 0xffff) throw new Error(`SCQ1 queue entry ${index} is too large`);
    pushU16(body, exact.length);
    body.push(...exact);
  }
  const bytes = encodeFixedEnvelope('SCQ1', Buffer.from(body));
  if (bytes.length > TI86_SCHOOLCALC_LIMITS.queueMaxBytes) {
    throw new Error(`SCQ1 queue exceeds ${TI86_SCHOOLCALC_LIMITS.queueMaxBytes}-byte TI-86 limit`);
  }
  return bytes;
}

/** Decode the fixed-layout queue while retaining its calculator identity. */
export function decodeTi86ResultQueueRecord(record) {
  const bytes = envelopeBytes(record, 'SCQ1');
  if (bytes.length > TI86_SCHOOLCALC_LIMITS.queueMaxBytes) {
    throw new Error(`SCQ1 queue exceeds ${TI86_SCHOOLCALC_LIMITS.queueMaxBytes}-byte TI-86 limit`);
  }
  const reader = new FixedRecordReader(decodeFixedEnvelope(bytes, 'SCQ1'), 'SCQ1');
  const deviceId = reader.shortAscii('deviceId');
  if (!COMPACT_DEVICE_ID.test(deviceId)) throw new Error('SCQ1 queue has an invalid deviceId');
  const count = reader.u16('record count');
  if (count > TI86_SCHOOLCALC_LIMITS.queueMaxRecords) {
    throw new Error(`SCQ1 queue exceeds ${TI86_SCHOOLCALC_LIMITS.queueMaxRecords}-record TI-86 limit`);
  }
  const records = [];
  const sequences = new Map();
  for (let index = 0; index < count; index += 1) {
    const exact = Buffer.from(reader.take(reader.u16(`record ${index} length`), `record ${index}`));
    const result = decodeCompactResultRecord(exact);
    if (result.deviceId !== deviceId) throw new Error(`SCQ1 queue entry ${index} belongs to another device`);
    const prior = sequences.get(result.sequence);
    if (prior && !prior.equals(exact)) throw new Error(`SCQ1 queue sequence ${result.sequence} conflicts`);
    if (prior) throw new Error(`SCQ1 queue repeats sequence ${result.sequence}`);
    sequences.set(result.sequence, exact);
    records.push(exact);
  }
  reader.done();
  assertStrictlyIncreasing([...sequences.keys()], 'SCQ1 queue');
  return Object.freeze({ deviceId, records: Object.freeze(records) });
}

/** Decode the fixed-layout acknowledgement staged as DSACKNEW. */
export function decodeTi86Acknowledgements(record) {
  const reader = new FixedRecordReader(decodeFixedEnvelope(record, 'SCA1'), 'SCA1');
  const deviceId = reader.shortAscii('deviceId');
  if (!COMPACT_DEVICE_ID.test(deviceId)) throw new Error('SCA1 acknowledgement has an invalid deviceId');
  const count = reader.u16('sequence count');
  if (count > TI86_SCHOOLCALC_LIMITS.queueMaxRecords) {
    throw new Error(`SCA1 acknowledgement exceeds ${TI86_SCHOOLCALC_LIMITS.queueMaxRecords}-sequence TI-86 limit`);
  }
  const sequences = [];
  for (let index = 0; index < count; index += 1) sequences.push(reader.u24(`sequence ${index}`));
  reader.done();
  assertStrictlyIncreasing(sequences, 'SCA1 acknowledgement');
  return Object.freeze({
    schema: 'school.calc.acknowledgements/v1', deviceId, sequences: Object.freeze(sequences),
  });
}

/** Decode the fixed-layout transaction/installed-state record staged as DSSYNC. */
export function decodeTi86SyncManifest(record) {
  const reader = new FixedRecordReader(decodeFixedEnvelope(record, 'SCM1'), 'SCM1');
  const deviceLength = reader.u8('deviceId length');
  if (deviceLength < 4 || deviceLength > 16) throw new Error('SCM1 manifest has an invalid deviceId length');
  const deviceBytes = reader.take(16, 'deviceId');
  if ([...deviceBytes.subarray(deviceLength)].some((byte) => byte !== 0)) {
    throw new Error('SCM1 manifest has nonzero deviceId padding');
  }
  const deviceId = asciiBytes(deviceBytes.subarray(0, deviceLength), 'SCM1 deviceId');
  if (!COMPACT_DEVICE_ID.test(deviceId)) throw new Error('SCM1 manifest has an invalid deviceId');
  const generationKey = reader.fixedAscii(10, 'generation key');
  const catalogGenerationKey = reader.fixedAscii(10, 'Catalog generation key');
  if (!ARTIFACT_KEY.test(generationKey) || !ARTIFACT_KEY.test(catalogGenerationKey)) {
    throw new Error('SCM1 manifest has an invalid generation key');
  }
  const flags = reader.u8('flags');
  if (flags & ~3) throw new Error('SCM1 manifest has unknown flag bits');
  const blockerMask = reader.u16('blocker mask');
  const knownBlockerMask = Object.values(MANIFEST_BLOCKER_BITS)
    .reduce((mask, bit) => mask | bit, MANIFEST_BLOCKER_OTHER);
  if (blockerMask & ~knownBlockerMask) throw new Error('SCM1 manifest has unknown blocker bits');
  const installedArtifacts = readSyncArtifacts(reader, reader.u8('installed artifact count'), 'installed artifact');
  assertUniqueArtifactMetadata(installedArtifacts);
  const removalCount = reader.u8('removal count');
  const removals = [];
  for (let index = 0; index < removalCount; index += 1) {
    removals.push(readSyncRemoval(reader, `removal ${index}`));
  }
  assertUniqueRemovals(removals);
  const acknowledgementCount = reader.u16('acknowledgement count');
  if (acknowledgementCount > TI86_SCHOOLCALC_LIMITS.queueMaxRecords) {
    throw new Error(`SCM1 manifest exceeds ${TI86_SCHOOLCALC_LIMITS.queueMaxRecords} acknowledgements`);
  }
  const acknowledgedSequences = [];
  for (let index = 0; index < acknowledgementCount; index += 1) {
    acknowledgedSequences.push(reader.u24(`acknowledgement ${index}`));
  }
  const deliveryAcknowledgementCount = reader.u8('delivery acknowledgement count');
  if (deliveryAcknowledgementCount > TI86_SCHOOLCALC_LIMITS.deliveryRequestMaxRecords) {
    throw new Error(`SCM1 manifest exceeds ${TI86_SCHOOLCALC_LIMITS.deliveryRequestMaxRecords} delivery acknowledgements`);
  }
  const acknowledgedRequestIds = [];
  for (let index = 0; index < deliveryAcknowledgementCount; index += 1) {
    acknowledgedRequestIds.push(reader.u24(`delivery acknowledgement ${index}`));
  }
  reader.done();
  assertStrictlyIncreasing(acknowledgedSequences, 'SCM1 acknowledgements');
  assertStrictlyIncreasing(acknowledgedRequestIds, 'SCM1 delivery acknowledgements');

  const ready = Boolean(flags & 1);
  const installedById = new Map(installedArtifacts.map((artifact) => [artifact.artifactId, artifact]));
  if (ready) {
    for (const removal of removals) {
      if (installedById.has(removal.artifactId)) {
        throw new Error('SCM1 removes an artifact retained by the installed set');
      }
    }
  }
  return Object.freeze({
    schema: 'school.calc.sync-manifest/v1',
    deviceId,
    generationKey,
    catalogGenerationKey,
    catalogChanged: Boolean(flags & 2),
    ready,
    blockerMask,
    blockers: Object.freeze(decodeManifestBlockers(blockerMask)),
    installedArtifacts: Object.freeze(installedArtifacts),
    removals: Object.freeze(removals),
    acknowledgedSequences: Object.freeze(acknowledgedSequences),
    acknowledgedRequestIds: Object.freeze(acknowledgedRequestIds),
  });
}

export class Ti86SchoolCalcCodec extends ISchoolCalcCodec {
  #nativeToolMapper;

  constructor({ nativeToolMapper = new Ti86NativeToolMapper() } = {}) {
    super();
    if (!nativeToolMapper || typeof nativeToolMapper.map !== 'function'
        || typeof nativeToolMapper.reasons !== 'function') {
      throw new Error('TI-86 SchoolCalc codec requires a native tool mapper');
    }
    this.#nativeToolMapper = nativeToolMapper;
  }

  get platformId() { return PLATFORM_ID; }

  describeCapabilities(rawInfo, rawState = null) {
    const info = decodeTi86Envelope(rawInfo, 'SCI1');
    if (info.schema !== 'school.calc.device-info/v1') {
      throw new Error('TI-86 SchoolCalc device info has an unsupported schema');
    }
    if (typeof info.shellVersion !== 'string' || !info.shellVersion.trim()) {
      throw new Error('TI-86 SchoolCalc device info has no shellVersion');
    }
    if (info.deviceId !== undefined && !COMPACT_DEVICE_ID.test(info.deviceId)) {
      throw new Error('TI-86 SchoolCalc device info has an invalid deviceId');
    }
    if (!Array.isArray(info.capabilities) || !info.capabilities.every((entry) => CAPABILITY.test(entry))) {
      throw new Error('TI-86 SchoolCalc device info has invalid capabilities');
    }
    const claimedCapabilities = [...new Set(info.capabilities)].sort();
    if (claimedCapabilities.length !== TI86_SCHOOLCALC_CLIENT_CAPABILITIES.length
        || claimedCapabilities.some((entry, index) => (
          entry !== [...TI86_SCHOOLCALC_CLIENT_CAPABILITIES].sort()[index]
        ))) {
      throw new Error('TI-86 SchoolCalc device info claims unapproved capabilities');
    }
    const runtimeModuleMask = integerInRange(
      info.runtimeModuleMask,
      0,
      TI86_SCHOOLCALC_RUNTIME_MODULE_FULL_MASK,
      'runtimeModuleMask',
    );
    const freeBytes = integerInRange(info.freeBytes, 0, TI86_MAX_USER_BYTES, 'freeBytes');
    const reportedMaxArtifactBytes = info.maxArtifactBytes === undefined
      ? Math.min(DEFAULT_MAX_ARTIFACT_BYTES, freeBytes)
      : integerInRange(info.maxArtifactBytes, 0, MAX_ENVELOPE_PAYLOAD, 'maxArtifactBytes');
    const availableArtifactBytes = Math.max(0,
      freeBytes - TI86_SCHOOLCALC_LIMITS.freeReserveBytes - TI86_SCHOOLCALC_LIMITS.variableOverheadBytes);
    const maxArtifactBytes = Math.min(DEFAULT_MAX_ARTIFACT_BYTES, reportedMaxArtifactBytes, availableArtifactBytes);
    const reportedInstalledArtifactIds = info.installedArtifactIds ?? [];
    if (!Array.isArray(reportedInstalledArtifactIds)
        || !reportedInstalledArtifactIds.every((entry) => Boolean(artifactKey(entry)))) {
      throw new Error('TI-86 SchoolCalc device info has invalid installedArtifactIds');
    }
    const installedState = rawState === null ? null : decodeTi86InstalledState(rawState);
    if (installedState && info.deviceId && installedState.deviceId !== info.deviceId) {
      throw new Error('TI-86 device info and installed state belong to different devices');
    }
    const installedArtifactIds = installedState
      ? installedState.installedArtifacts.map((artifact) => artifact.artifactId)
      : reportedInstalledArtifactIds;
    return {
      platformId: PLATFORM_ID,
      shellVersion: info.shellVersion,
      deviceId: info.deviceId ?? null,
      capabilities: [...new Set([
        ...claimedCapabilities,
        ...promotedRuntimeCapabilities(runtimeModuleMask),
      ])].sort(),
      installedArtifactIds: [...new Set(installedArtifactIds)],
      installationGeneration: installedState?.generationKey ?? null,
      limits: {
        screenWidth: 128,
        screenHeight: 64,
        variableNameLength: 8,
        freeBytes,
        maxArtifactBytes,
        artifactTargetBytes: TI86_SCHOOLCALC_LIMITS.lessonTargetBytes,
        catalogStateTargetBytes: TI86_SCHOOLCALC_LIMITS.catalogStateTargetBytes,
        catalogStateMaxBytes: TI86_SCHOOLCALC_LIMITS.catalogStateMaxBytes,
        catalogRecordTargetBytes: TI86_SCHOOLCALC_LIMITS.catalogRecordTargetBytes,
        catalogRecordMaxBytes: TI86_SCHOOLCALC_LIMITS.catalogRecordMaxBytes,
        queueTargetBytes: TI86_SCHOOLCALC_LIMITS.queueTargetBytes,
        queueMaxBytes: TI86_SCHOOLCALC_LIMITS.queueMaxBytes,
        queueMaxRecords: TI86_SCHOOLCALC_LIMITS.queueMaxRecords,
        deliveryRequestTargetBytes: TI86_SCHOOLCALC_LIMITS.deliveryRequestTargetBytes,
        deliveryRequestMaxBytes: TI86_SCHOOLCALC_LIMITS.deliveryRequestMaxBytes,
        deliveryRequestMaxRecords: TI86_SCHOOLCALC_LIMITS.deliveryRequestMaxRecords,
        learnerRosterTargetBytes: TI86_SCHOOLCALC_LIMITS.learnerRosterTargetBytes,
        learnerRosterMaxBytes: TI86_SCHOOLCALC_LIMITS.learnerRosterMaxBytes,
        learnerRosterMaxRecords: TI86_SCHOOLCALC_LIMITS.learnerRosterMaxRecords,
        progressProjectionTargetBytes: TI86_SCHOOLCALC_LIMITS.progressProjectionTargetBytes,
        progressProjectionMaxBytes: TI86_SCHOOLCALC_LIMITS.progressProjectionMaxBytes,
        interactionRequestTargetBytes: TI86_SCHOOLCALC_LIMITS.interactionRequestTargetBytes,
        interactionRequestMaxBytes: TI86_SCHOOLCALC_LIMITS.interactionRequestMaxBytes,
        interactionResponseTargetBytes: TI86_SCHOOLCALC_LIMITS.interactionResponseTargetBytes,
        interactionResponseMaxBytes: TI86_SCHOOLCALC_LIMITS.interactionResponseMaxBytes,
        acknowledgementMaxBytes: TI86_SCHOOLCALC_LIMITS.acknowledgementMaxBytes,
        syncManifestMaxBytes: TI86_SCHOOLCALC_LIMITS.syncManifestMaxBytes,
        nativeHandoffWorkspaceBytes: TI86_SCHOOLCALC_LIMITS.nativeSnapshotMaxBytes,
        reservedFreeBytes: TI86_SCHOOLCALC_LIMITS.freeReserveBytes,
        variableOverheadBytes: TI86_SCHOOLCALC_LIMITS.variableOverheadBytes,
        localStateCommitBytes: TI86_SCHOOLCALC_LIMITS.localStateCommitBytes,
        catalogCommitCopyCount: TI86_SCHOOLCALC_LIMITS.catalogCommitCopyCount,
        manifestCommitCopyCount: TI86_SCHOOLCALC_LIMITS.manifestCommitCopyCount,
        queueCommitCopyCount: TI86_SCHOOLCALC_LIMITS.queueCommitCopyCount,
        interactionResponseCommitCopyCount: TI86_SCHOOLCALC_LIMITS.interactionResponseCommitCopyCount,
      },
    };
  }

  encodeDeviceIdentity({ deviceId }) {
    if (!COMPACT_DEVICE_ID.test(deviceId || '')) throw new Error('TI-86 device identity has an invalid deviceId');
    return encodeTi86Envelope('SCI1', {
      schema: 'school.calc.device-identity/v1',
      deviceId,
    });
  }

  recognizesDeviceIdentity(record) {
    return hasBinaryMagic(record, 'SCI1');
  }

  decodeDeviceIdentity(record) {
    const decoded = decodeTi86Envelope(record, 'SCI1');
    if (decoded?.schema !== 'school.calc.device-identity/v1'
      || !COMPACT_DEVICE_ID.test(decoded.deviceId || '')) {
      throw new Error('TI-86 device identity record is invalid');
    }
    return {
      schema: decoded.schema,
      deviceId: decoded.deviceId,
      platformId: PLATFORM_ID,
    };
  }

  encodeLearnerRoster(roster) {
    if (roster?.schema !== 'school.calc.learner-roster/v1'
      || !COMPACT_DEVICE_ID.test(roster.deviceId || '')
      || typeof roster.generation !== 'string'
      || !Array.isArray(roster.profiles)
      || roster.profiles.length > TI86_SCHOOLCALC_LIMITS.learnerRosterMaxRecords) {
      throw new Error('TI-86 learner roster is invalid');
    }
    const keys = new Set();
    const body = [];
    pushShortAscii(body, roster.deviceId, 'deviceId');
    body.push(...Buffer.from(ti86GenerationKey(roster.generation), 'ascii'));
    body.push(roster.profiles.length);
    roster.profiles.forEach((profile, index) => {
      if (!Number.isSafeInteger(profile?.learnerKey) || profile.learnerKey < 1 || profile.learnerKey > 0xffff
          || keys.has(profile.learnerKey)) {
        throw new Error(`TI-86 learner roster profile ${index} has an invalid or repeated learnerKey`);
      }
      keys.add(profile.learnerKey);
      pushU16(body, profile.learnerKey);
      pushShortAscii(body, ti86ProfileLabel(profile.label), `learner roster profile ${index} label`);
    });
    const record = encodeFixedEnvelope('SCU1', Buffer.from(body));
    if (record.length > TI86_SCHOOLCALC_LIMITS.learnerRosterMaxBytes) {
      throw new Error(`SCU1 learner roster exceeds ${TI86_SCHOOLCALC_LIMITS.learnerRosterMaxBytes}-byte TI-86 limit`);
    }
    return record;
  }

  encodeProgressProjection(projection) {
    if (projection?.schema !== 'school.calc.progress-projection/v1'
      || !COMPACT_DEVICE_ID.test(projection.deviceId || '')
      || typeof projection.generation !== 'string'
      || !Array.isArray(projection.profiles)
      || projection.profiles.length > TI86_SCHOOLCALC_LIMITS.learnerRosterMaxRecords) {
      throw new Error('TI-86 progress projection is invalid');
    }
    const learnerKeys = new Set();
    const actionKeys = new Set();
    const projectedHistories = allocateTi86ProgressHistories(projection.profiles);
    const body = [];
    pushShortAscii(body, projection.deviceId, 'deviceId');
    body.push(...Buffer.from(ti86GenerationKey(projection.generation), 'ascii'));
    body.push(projection.profiles.length);
    projection.profiles.forEach((profile, index) => {
      if (!Number.isSafeInteger(profile?.learnerKey) || profile.learnerKey < 1
          || profile.learnerKey > 0xffff || learnerKeys.has(profile.learnerKey)) {
        throw new Error(`TI-86 progress profile ${index} has an invalid or repeated learnerKey`);
      }
      learnerKeys.add(profile.learnerKey);
      pushU16(body, profile.learnerKey);
      const summary = normalizeProgressSummary(profile.summary, index);
      [
        summary.evidenceCount, summary.engagementCount, summary.responseCount,
        summary.correctCount, summary.completionCount, summary.activityCount,
        summary.assessmentCount,
      ].forEach((value) => pushU32(body, value));
      body.push(summary.scorePercent === null ? PROGRESS_SCORE_NONE : summary.scorePercent);
      body.push(...Buffer.from(progressDate(summary.lastActivityAt), 'ascii'));

      const recentScores = (profile.recentScores ?? []).slice(0, PROGRESS_RECENT_SCORE_LIMIT);
      if (!Array.isArray(profile.recentScores)) throw new Error(`TI-86 progress profile ${index} recentScores must be an array`);
      body.push(recentScores.length);
      recentScores.forEach((recent, recentIndex) => {
        const correct = integerInRange(recent?.score?.correct, 0, 0xffff, `profile ${index} recent score ${recentIndex} correct`);
        const total = integerInRange(recent?.score?.total, 1, 0xffff, `profile ${index} recent score ${recentIndex} total`);
        const percent = integerInRange(recent?.score?.percent, 0, 100, `profile ${index} recent score ${recentIndex} percent`);
        if (correct > total || percent !== Math.round((correct / total) * 100)) {
          throw new Error(`TI-86 progress profile ${index} recent score ${recentIndex} is inconsistent`);
        }
        const verification = PROGRESS_VERIFICATION[recent.verification];
        if (!verification) throw new Error(`TI-86 progress profile ${index} recent score ${recentIndex} has invalid verification`);
        pushU16(body, correct);
        pushU16(body, total);
        body.push(percent, verification);
        body.push(...Buffer.from(progressDate(recent.occurredAt, { required: true }), 'ascii'));
        pushShortAscii(body, ti86ProgressLabel(recent.activityKind, 12),
          `profile ${index} recent score ${recentIndex} activity kind`);
      });

      if (!Array.isArray(profile.followUps)) throw new Error(`TI-86 progress profile ${index} followUps must be an array`);
      const followUps = profile.followUps.slice(0, PROGRESS_FOLLOW_UP_LIMIT);
      body.push(followUps.length);
      followUps.forEach((followUp, followUpIndex) => {
        const kind = FOLLOW_UP_KIND[followUp?.kind];
        const availability = FOLLOW_UP_AVAILABILITY[followUp?.availability];
        const priority = integerInRange(followUp?.priority ?? 100, 0, 1000,
          `profile ${index} follow-up ${followUpIndex} priority`);
        if (!kind || !availability || typeof followUp.actionId !== 'string' || !followUp.actionId
            || typeof followUp.target?.type !== 'string' || !followUp.target.type
            || typeof followUp.target?.id !== 'string' || !followUp.target.id) {
          throw new Error(`TI-86 progress profile ${index} follow-up ${followUpIndex} is invalid`);
        }
        const actionKey = ti86ProgressActionKey(followUp, profile.learnerKey);
        if (actionKeys.has(actionKey)) {
          throw new Error(`TI-86 progress projection has colliding follow-up action key '${actionKey}'`);
        }
        actionKeys.add(actionKey);
        body.push(...Buffer.from(actionKey, 'ascii'), kind, availability);
        pushU16(body, priority);
        pushShortAscii(body, ti86ProgressLabel(followUp.label, 20),
          `profile ${index} follow-up ${followUpIndex} label`);
      });

      const historyNodes = projectedHistories[index];
      body.push(historyNodes.length);
      historyNodes.forEach((node, historyIndex) => {
        body.push(
          node.parentIndex === null ? 0xff : node.parentIndex,
          PROGRESS_HISTORY_KIND[node.kind] | (node.pending ? PROGRESS_HISTORY_PENDING : 0),
          node.scorePercent === null ? PROGRESS_SCORE_NONE : node.scorePercent,
        );
        pushU16(body, node.activityCount);
        pushU16(body, node.completionCount);
        pushShortAscii(body, node.label,
          `profile ${index} curriculum-history node ${historyIndex} label`);
      });
    });
    const record = encodeFixedEnvelope('SCG1', Buffer.from(body));
    if (record.length > TI86_SCHOOLCALC_LIMITS.progressProjectionMaxBytes) {
      throw new Error(`SCG1 progress projection exceeds ${TI86_SCHOOLCALC_LIMITS.progressProjectionMaxBytes}-byte TI-86 limit`);
    }
    return record;
  }

  projectFollowUpKey(action, learnerKey) {
    if (!Number.isSafeInteger(learnerKey) || learnerKey < 1 || learnerKey > 0xffff
        || !action || typeof action.actionId !== 'string' || !action.actionId
        || typeof action.kind !== 'string' || !action.kind
        || typeof action.target?.type !== 'string' || !action.target.type
        || typeof action.target?.id !== 'string' || !action.target.id) {
      throw new Error('TI-86 follow-up key input is invalid');
    }
    return ti86ProgressActionKey(action, learnerKey);
  }

  decodeInteractionRequest(record) {
    return decodeTi86InteractionRequest(record);
  }

  encodeInteractionResponse(response) {
    return encodeTi86InteractionResponse(response);
  }

  encodeCatalog(projection) {
    if (projection?.schema !== 'school.calc.catalog-projection/v1'
      || projection.platformId !== PLATFORM_ID
      || !COMPACT_DEVICE_ID.test(projection.deviceId || '')
      || typeof projection.generation !== 'string'
      || !Array.isArray(projection.catalogs)
      || projection.catalogs.length !== 1) {
      throw new Error('TI-86 Catalog projection is invalid');
    }
    const record = encodeTi86Envelope('SCC1', {
      ...projection,
      generationKey: ti86GenerationKey(projection.generation),
    });
    if (record.length > TI86_SCHOOLCALC_LIMITS.catalogRecordMaxBytes) {
      throw new Error(`SCC1 Catalog exceeds ${TI86_SCHOOLCALC_LIMITS.catalogRecordMaxBytes}-byte TI-86 record limit`);
    }
    return record;
  }

  decodeDeliveryRequests(record) {
    return decodeTi86DeliveryRequestRecord(record);
  }

  supports(bundle, capabilities = defaultCapabilityReport()) {
    const reasons = [];
    if (bundle?.schema !== 'school.learning-lesson/v1') {
      reasons.push('bundle schema is not school.learning-lesson/v1');
    }
    const available = new Set(capabilities?.capabilities ?? []);
    for (const required of bundle?.capabilities ?? []) {
      if (!available.has(required)) reasons.push(`missing capability ${required}`);
    }
    if (!Array.isArray(bundle?.lesson?.modules) || bundle.lesson.modules.length === 0) {
      reasons.push('lesson has no modules');
    } else if (bundle.lesson.modules.length > RESULT_MODULE_MASK + 1) {
      reasons.push(`lesson exceeds ${RESULT_MODULE_MASK + 1} TI-86 modules`);
    } else {
      reasons.push(...ti86ProjectionReasons(bundle.lesson.modules, this.#nativeToolMapper));
    }
    return { compatible: reasons.length === 0, reasons: [...new Set(reasons)] };
  }

  compile(bundle, capabilities = defaultCapabilityReport(), { sourceBundle = bundle } = {}) {
    const compatibility = this.supports(bundle, capabilities);
    if (!compatibility.compatible) {
      throw new Error(`TI-86 cannot compile lesson: ${compatibility.reasons.join('; ')}`);
    }

    const sourceText = canonicalJson(sourceBundle);
    const runtimeText = canonicalJson(bundle);
    const sourceDigest = sha256Hex(sourceText);
    const artifactKey = createHash('sha256')
      .update(`${PLATFORM_ID}:${ARTIFACT_CODEC_VERSION}\n${runtimeText}`)
      .digest();
    const artifactId = `sc:${PLATFORM_ID}:${base32(artifactKey).slice(0, 10)}`;
    const variableName = ti86ArtifactVariableName(artifactId);
    const projected = projectBundle(bundle, artifactId, this.#nativeToolMapper);
    const bytes = encodeTi86Envelope('SCP1', projected);
    const maxBytes = capabilities?.limits?.maxArtifactBytes ?? DEFAULT_MAX_ARTIFACT_BYTES;
    if (bytes.length > maxBytes) {
      throw new Error(`TI-86 lesson artifact is ${bytes.length} bytes; device limit is ${maxBytes}`);
    }

    const aboveTarget = bytes.length > TI86_SCHOOLCALC_LIMITS.lessonTargetBytes;
    return {
      artifactId,
      platformId: PLATFORM_ID,
      codecVersion: ARTIFACT_CODEC_VERSION,
      variableName,
      mediaType: 'application/vnd.daylight.schoolcalc.ti86',
      bytes,
      byteLength: bytes.length,
      byteDigest: sha256Hex(bytes),
      sourceDigest,
      source: {
        address: bundle.address,
        lessonId: bundle.lesson.lessonId,
        moduleIds: bundle.lesson.modules.map((module) => module.moduleId),
      },
      resource: {
        targetBytes: TI86_SCHOOLCALC_LIMITS.lessonTargetBytes,
        hardCeilingBytes: TI86_SCHOOLCALC_LIMITS.lessonMaxBytes,
        effectiveCeilingBytes: maxBytes,
        aboveTarget,
      },
      warnings: aboveTarget ? [{
        code: 'TI86_ARTIFACT_ABOVE_TARGET',
        byteLength: bytes.length,
        targetBytes: TI86_SCHOOLCALC_LIMITS.lessonTargetBytes,
      }] : [],
    };
  }

  decodeResult(record) {
    const decoded = decodeCompactResultRecord(record);
    validateResult(decoded);
    const normalizedRecordText = canonicalJson(decoded);
    return {
      schema: decoded.schema,
      deviceId: decoded.deviceId,
      sequence: decoded.sequence,
      learnerKey: decoded.learnerKey,
      artifactId: decoded.artifactId,
      moduleIndex: decoded.moduleIndex,
      kind: decoded.kind,
      ...(decoded.kind === 'responses'
        ? {
          responses: structuredClone(decoded.responses),
          localScore: structuredClone(decoded.localScore),
          ...(decoded.adaptiveStudy
            ? { adaptiveStudy: structuredClone(decoded.adaptiveStudy) }
            : {}),
        }
        : { progress: structuredClone(decoded.progress) }),
      normalizedRecord: JSON.parse(normalizedRecordText),
      normalizedRecordText,
      recordDigest: sha256Hex(normalizedRecordText),
    };
  }

  decodeStudyEntry(record) { return decodeTi86StudyEntry(record); }

  encodeStudyPrescription(prescription) { return encodeTi86StudyPrescription(prescription); }

  encodeStudyAcknowledgement(value) { return encodeTi86StudyAcknowledgement(value); }

  recognizesResult(record) {
    if (typeof record === 'string') return record.startsWith(RESULT_QR_PREFIX);
    return hasBinaryMagic(record, 'SCR1');
  }

  decodeResultQueue(record) {
    return decodeTi86ResultQueueRecord(record).records.map((entry) => Buffer.from(entry));
  }

  encodeAcknowledgements({ deviceId, sequences }) {
    if (!COMPACT_DEVICE_ID.test(deviceId || '')) throw new Error('TI-86 acknowledgement has an invalid deviceId');
    if (!Array.isArray(sequences) || !sequences.every((value) => Number.isSafeInteger(value) && value >= 0 && value <= 0xff_ffff)) {
      throw new Error('TI-86 acknowledgement sequences must be 24-bit non-negative integers');
    }
    const normalized = [...new Set(sequences)].sort((a, b) => a - b);
    if (normalized.length > TI86_SCHOOLCALC_LIMITS.queueMaxRecords) {
      throw new Error(`SCA1 acknowledgement exceeds ${TI86_SCHOOLCALC_LIMITS.queueMaxRecords}-sequence TI-86 limit`);
    }
    const body = [];
    pushShortAscii(body, deviceId, 'deviceId');
    pushU16(body, normalized.length);
    normalized.forEach((sequence) => pushU24(body, sequence));
    const record = encodeFixedEnvelope('SCA1', Buffer.from(body));
    if (record.length > TI86_SCHOOLCALC_LIMITS.acknowledgementMaxBytes) {
      throw new Error(`SCA1 acknowledgement exceeds ${TI86_SCHOOLCALC_LIMITS.acknowledgementMaxBytes}-byte TI-86 limit`);
    }
    return record;
  }

  encodeSyncManifest(plan) {
    if (plan?.schema !== 'school.calc.sync-plan/v1'
      || plan.platformId !== PLATFORM_ID
      || !COMPACT_DEVICE_ID.test(plan.deviceId || '')
      || typeof plan.generation !== 'string'
      || typeof plan.catalog?.generation !== 'string'
      || !Array.isArray(plan.removals)
      || !Array.isArray(plan.artifacts)
      || !Array.isArray(plan.installedArtifacts)
      || !Array.isArray(plan.acknowledgements?.sequences)) {
      throw new Error('TI-86 sync plan is invalid');
    }
    const artifacts = plan.artifacts.map((artifact, index) => (
      normalizeSyncArtifact(artifact, `staged artifact ${index}`)
    ));
    const installedArtifacts = plan.installedArtifacts.map((artifact, index) => (
      normalizeSyncArtifact(artifact, `installed artifact ${index}`)
    ));
    assertUniqueArtifactMetadata(installedArtifacts);
    const removals = plan.removals.map((removal, index) => normalizeSyncRemoval(removal, index));
    const acknowledgedSequences = [...new Set(plan.acknowledgements.sequences)].sort((a, b) => a - b);
    if (!acknowledgedSequences.every((value) => Number.isSafeInteger(value) && value >= 0 && value <= 0xff_ffff)) {
      throw new Error('TI-86 sync plan has invalid acknowledgement sequences');
    }
    if (acknowledgedSequences.length > TI86_SCHOOLCALC_LIMITS.queueMaxRecords) {
      throw new Error(`TI-86 sync plan exceeds ${TI86_SCHOOLCALC_LIMITS.queueMaxRecords} acknowledgements`);
    }
    const acknowledgedRequestIds = [...new Set(
      plan.deliveryAcknowledgements?.requestIds ?? [],
    )].sort((a, b) => a - b);
    if (!acknowledgedRequestIds.every((value) => (
      Number.isSafeInteger(value) && value >= 0 && value <= 0xff_ffff
    ))) {
      throw new Error('TI-86 sync plan has invalid delivery acknowledgement IDs');
    }
    if (acknowledgedRequestIds.length > TI86_SCHOOLCALC_LIMITS.deliveryRequestMaxRecords) {
      throw new Error(`TI-86 sync plan exceeds ${TI86_SCHOOLCALC_LIMITS.deliveryRequestMaxRecords} delivery acknowledgements`);
    }
    const blockerMask = encodeManifestBlockers(plan.blockers ?? []);
    if (artifacts.length > 255 || installedArtifacts.length > 255 || removals.length > 255) {
      throw new Error('TI-86 sync plan exceeds its item-count limit');
    }
    if (plan.ready === true) {
      const installedById = new Map(installedArtifacts.map((artifact) => [artifact.artifactId, artifact]));
      for (const artifact of artifacts) {
        const retained = installedById.get(artifact.artifactId);
        if (!retained || !sameArtifactMetadata(retained, artifact)) {
          throw new Error('TI-86 staged artifact is absent from the installed set');
        }
      }
    }
    const body = [];
    const deviceBytes = Buffer.from(plan.deviceId, 'ascii');
    body.push(deviceBytes.length, ...deviceBytes, ...Buffer.alloc(16 - deviceBytes.length));
    body.push(...Buffer.from(ti86GenerationKey(plan.generation), 'ascii'));
    body.push(...Buffer.from(ti86GenerationKey(plan.catalog.generation), 'ascii'));
    body.push((plan.ready === true ? 1 : 0) | (plan.catalog.changed === true ? 2 : 0));
    pushU16(body, blockerMask);
    body.push(installedArtifacts.length);
    installedArtifacts.forEach((artifact) => pushSyncArtifact(body, artifact));
    body.push(removals.length);
    removals.forEach((removal) => pushSyncRemoval(body, removal));
    pushU16(body, acknowledgedSequences.length);
    acknowledgedSequences.forEach((sequence) => pushU24(body, sequence));
    body.push(acknowledgedRequestIds.length);
    acknowledgedRequestIds.forEach((requestId) => pushU24(body, requestId));
    const record = encodeFixedEnvelope('SCM1', Buffer.from(body));
    if (record.length > TI86_SCHOOLCALC_LIMITS.syncManifestMaxBytes) {
      throw new Error(`SCM1 manifest exceeds ${TI86_SCHOOLCALC_LIMITS.syncManifestMaxBytes}-byte TI-86 limit`);
    }
    return record;
  }
}

function normalizeSyncArtifact(artifact, label) {
  if (!artifactKey(artifact?.artifactId)
      || !ARTIFACT_VARIABLE.test(artifact?.variableName || '')
      || artifact.variableName !== ti86ArtifactVariableName(artifact.artifactId)
      || !Number.isInteger(artifact?.byteLength)
      || artifact.byteLength <= 0
      || artifact.byteLength > TI86_SCHOOLCALC_LIMITS.lessonMaxBytes
      || !SHA256_HEX.test(artifact?.byteDigest || '')) {
    throw new Error(`TI-86 ${label} metadata is invalid`);
  }
  return {
    artifactId: artifact.artifactId,
    variableName: artifact.variableName,
    byteLength: artifact.byteLength,
    byteDigest: artifact.byteDigest,
  };
}

function normalizeSyncRemoval(removal, index) {
  if (!artifactKey(removal?.artifactId)
      || !ARTIFACT_VARIABLE.test(removal?.variableName || '')
      || removal.variableName !== ti86ArtifactVariableName(removal.artifactId)) {
    throw new Error(`TI-86 removal ${index} metadata is invalid`);
  }
  return { artifactId: removal.artifactId, variableName: removal.variableName };
}

function pushSyncArtifact(target, artifact) {
  target.push(...Buffer.from(artifactKey(artifact.artifactId), 'ascii'));
  target.push(...Buffer.from(artifact.variableName, 'ascii'));
  pushU16(target, artifact.byteLength);
  target.push(...Buffer.from(artifact.byteDigest, 'hex'));
}

function readSyncArtifacts(reader, count, label) {
  const artifacts = [];
  for (let index = 0; index < count; index += 1) {
    const key = reader.fixedAscii(10, `${label} ${index} key`);
    const variableName = reader.fixedAscii(8, `${label} ${index} variable`);
    const byteLength = reader.u16(`${label} ${index} length`);
    const byteDigest = reader.take(32, `${label} ${index} digest`).toString('hex');
    artifacts.push(normalizeSyncArtifact({
      artifactId: `${ARTIFACT_PREFIX}${key}`, variableName, byteLength, byteDigest,
    }, `${label} ${index}`));
  }
  return artifacts;
}

function pushSyncRemoval(target, removal) {
  target.push(...Buffer.from(artifactKey(removal.artifactId), 'ascii'));
  target.push(...Buffer.from(removal.variableName, 'ascii'));
}

function readSyncRemoval(reader, label) {
  const artifactId = `${ARTIFACT_PREFIX}${reader.fixedAscii(10, `${label} key`)}`;
  const variableName = reader.fixedAscii(8, `${label} variable`);
  if (!artifactKey(artifactId)
      || !ARTIFACT_VARIABLE.test(variableName)
      || variableName !== ti86ArtifactVariableName(artifactId)) {
    throw new Error(`SCM1 ${label} metadata is invalid`);
  }
  return Object.freeze({ artifactId, variableName });
}

function assertUniqueArtifactMetadata(artifacts) {
  const ids = new Set();
  const variables = new Set();
  for (const artifact of artifacts) {
    if (ids.has(artifact.artifactId) || variables.has(artifact.variableName)) {
      throw new Error('TI-86 installed-state manifest repeats an artifact ID or variable name');
    }
    ids.add(artifact.artifactId);
    variables.add(artifact.variableName);
  }
}

function assertUniqueRemovals(removals) {
  const ids = new Set();
  const variables = new Set();
  for (const removal of removals) {
    if (ids.has(removal.artifactId) || variables.has(removal.variableName)) {
      throw new Error('SCM1 repeats a removal artifact ID or variable name');
    }
    ids.add(removal.artifactId);
    variables.add(removal.variableName);
  }
}

function sameArtifactMetadata(left, right) {
  return left.artifactId === right.artifactId
    && left.variableName === right.variableName
    && left.byteLength === right.byteLength
    && left.byteDigest === right.byteDigest;
}

function encodeManifestBlockers(blockers) {
  if (!Array.isArray(blockers)) throw new Error('TI-86 sync plan blockers must be an array');
  let mask = 0;
  for (const blocker of blockers) {
    if (typeof blocker?.code !== 'string' || !blocker.code) {
      throw new Error('TI-86 sync plan has an invalid blocker code');
    }
    mask |= MANIFEST_BLOCKER_BITS[blocker.code] ?? MANIFEST_BLOCKER_OTHER;
  }
  return mask;
}

function decodeManifestBlockers(mask) {
  const blockers = Object.entries(MANIFEST_BLOCKER_BITS)
    .filter(([, bit]) => mask & bit)
    .map(([code]) => Object.freeze({ code }));
  if (mask & MANIFEST_BLOCKER_OTHER) blockers.push(Object.freeze({ code: 'OTHER' }));
  return blockers;
}

function asciiBytes(bytes, label) {
  if ([...bytes].some((byte) => byte < 0x20 || byte > 0x7e)) {
    throw new Error(`${label} is not printable ASCII`);
  }
  return bytes.toString('ascii');
}

function assertStrictlyIncreasing(values, label) {
  for (let index = 0; index < values.length; index += 1) {
    if (!Number.isSafeInteger(values[index]) || values[index] < 0 || values[index] > 0xff_ffff
        || (index > 0 && values[index] <= values[index - 1])) {
      throw new Error(`${label} are not canonical increasing 24-bit sequences`);
    }
  }
}

function hasBinaryMagic(record, magic) {
  if (!Buffer.isBuffer(record) && !(record instanceof Uint8Array)) return false;
  const bytes = Buffer.isBuffer(record)
    ? record
    : Buffer.from(record.buffer, record.byteOffset, record.byteLength);
  return bytes.length >= 4 && bytes.toString('ascii', 0, 4) === magic;
}

const BINARY_TAG = Object.freeze({
  null: 0,
  false: 1,
  true: 2,
  int32: 3,
  float64: 4,
  string: 5,
  array: 6,
  map: 7,
  bytes: 8,
});
const MAX_BINARY_DEPTH = 32;

/**
 * Compact deterministic value tree used by SCI1, SCC1, and SCP1.
 * Strings (including map keys) live in one u16-indexed table, keeping repeated
 * schema keys and labels out of the calculator payload. SCQ1, SCA1, SCM1, and
 * SCR1 use purpose-built fixed layouts inside the same outer envelope.
 */
function encodeBinaryDocument(value) {
  const strings = [];
  const stringIndices = new Map();
  collectStrings(value, { strings, stringIndices, depth: 0 });
  if (strings.length > 0xffff) throw new Error('TI-86 binary document has too many strings');

  const chunks = [u16Buffer(strings.length)];
  for (const entry of strings) {
    const encoded = Buffer.from(entry, 'utf8');
    if (encoded.length > 0xffff) throw new Error('TI-86 binary document string exceeds 65535 bytes');
    // The declared length remains the UTF-8 payload length. A physical NUL
    // separator gives the constrained Z80 reader an independent copy stop.
    chunks.push(u16Buffer(encoded.length), encoded, Buffer.from([0]));
  }
  chunks.push(encodeBinaryValue(value, stringIndices, 0));
  return Buffer.concat(chunks);
}

function collectStrings(value, state) {
  if (state.depth > MAX_BINARY_DEPTH) throw new Error('TI-86 binary document exceeds maximum nesting depth');
  if (typeof value === 'string') addString(value, state);
  else if (Array.isArray(value)) value.forEach((entry) => collectStrings(entry, { ...state, depth: state.depth + 1 }));
  else if (isPlainObject(value)) {
    Object.keys(value).sort().filter((key) => value[key] !== undefined).forEach((key) => {
      addString(key, state);
      collectStrings(value[key], { ...state, depth: state.depth + 1 });
    });
  } else if (value !== null && typeof value !== 'boolean' && typeof value !== 'number'
    && !Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    throw new Error(`TI-86 binary document cannot encode ${typeof value}`);
  }
}

function addString(value, { strings, stringIndices }) {
  if (stringIndices.has(value)) return;
  stringIndices.set(value, strings.length);
  strings.push(value);
}

function encodeBinaryValue(value, stringIndices, depth) {
  if (depth > MAX_BINARY_DEPTH) throw new Error('TI-86 binary document exceeds maximum nesting depth');
  if (value === null) return Buffer.from([BINARY_TAG.null]);
  if (value === false) return Buffer.from([BINARY_TAG.false]);
  if (value === true) return Buffer.from([BINARY_TAG.true]);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('TI-86 binary document cannot encode non-finite numbers');
    if (Number.isInteger(value) && value >= -0x8000_0000 && value <= 0x7fff_ffff) {
      const encoded = Buffer.alloc(5);
      encoded[0] = BINARY_TAG.int32;
      encoded.writeInt32LE(Object.is(value, -0) ? 0 : value, 1);
      return encoded;
    }
    const encoded = Buffer.alloc(9);
    encoded[0] = BINARY_TAG.float64;
    encoded.writeDoubleLE(Object.is(value, -0) ? 0 : value, 1);
    return encoded;
  }
  if (typeof value === 'string') {
    return Buffer.from([BINARY_TAG.string, ...u16Bytes(stringIndices.get(value))]);
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    if (bytes.length > 0xffff) throw new Error('TI-86 binary document byte string exceeds 65535 bytes');
    return Buffer.concat([Buffer.from([BINARY_TAG.bytes]), u16Buffer(bytes.length), bytes]);
  }
  if (Array.isArray(value)) {
    if (value.length > 0xffff) throw new Error('TI-86 binary document array is too large');
    return Buffer.concat([
      Buffer.from([BINARY_TAG.array]),
      u16Buffer(value.length),
      ...value.map((entry) => encodeBinaryValue(entry, stringIndices, depth + 1)),
    ]);
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort().filter((key) => value[key] !== undefined);
    if (keys.length > 0xffff) throw new Error('TI-86 binary document mapping is too large');
    const entries = keys.flatMap((key) => [
      u16Buffer(stringIndices.get(key)),
      encodeBinaryValue(value[key], stringIndices, depth + 1),
    ]);
    return Buffer.concat([Buffer.from([BINARY_TAG.map]), u16Buffer(keys.length), ...entries]);
  }
  throw new Error(`TI-86 binary document cannot encode ${typeof value}`);
}

function decodeBinaryDocument(bytes, label) {
  const reader = new BinaryDocumentReader(bytes, label);
  const stringCount = reader.u16('string count');
  const strings = [];
  const seen = new Set();
  for (let index = 0; index < stringCount; index += 1) {
    const value = reader.utf8(reader.u16(`string ${index} length`), `string ${index}`);
    if (reader.u8(`string ${index} terminator`) !== 0) {
      throw new Error(`${label} binary document string ${index} lacks its NUL terminator`);
    }
    if (seen.has(value)) throw new Error(`${label} binary document repeats a string-table value`);
    seen.add(value);
    strings.push(value);
  }
  const value = reader.value(strings, 0);
  reader.done();
  return value;
}

class BinaryDocumentReader {
  #bytes; #offset = 0; #label; #nodes = 0;

  constructor(bytes, label) { this.#bytes = bytes; this.#label = label; }

  u8(name) { this.#need(1, name); return this.#bytes[this.#offset++]; }

  u16(name) {
    this.#need(2, name);
    const value = this.#bytes.readUInt16LE(this.#offset);
    this.#offset += 2;
    return value;
  }

  utf8(length, name) {
    const bytes = this.take(length, name);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new Error(`${this.#label} binary document has invalid UTF-8 in ${name}`); }
  }

  take(length, name) {
    this.#need(length, name);
    const value = this.#bytes.subarray(this.#offset, this.#offset + length);
    this.#offset += length;
    return value;
  }

  value(strings, depth) {
    if (depth > MAX_BINARY_DEPTH) throw new Error(`${this.#label} binary document exceeds maximum nesting depth`);
    this.#nodes += 1;
    if (this.#nodes > 0xffff) throw new Error(`${this.#label} binary document has too many values`);
    const tag = this.u8('value tag');
    if (tag === BINARY_TAG.null) return null;
    if (tag === BINARY_TAG.false) return false;
    if (tag === BINARY_TAG.true) return true;
    if (tag === BINARY_TAG.int32) {
      this.#need(4, 'int32');
      const value = this.#bytes.readInt32LE(this.#offset);
      this.#offset += 4;
      return value;
    }
    if (tag === BINARY_TAG.float64) {
      this.#need(8, 'float64');
      const value = this.#bytes.readDoubleLE(this.#offset);
      this.#offset += 8;
      if (!Number.isFinite(value)) throw new Error(`${this.#label} binary document contains a non-finite number`);
      return value;
    }
    if (tag === BINARY_TAG.string) return this.#string(strings, this.u16('string reference'));
    if (tag === BINARY_TAG.bytes) return Buffer.from(this.take(this.u16('byte string length'), 'byte string'));
    if (tag === BINARY_TAG.array) {
      const count = this.u16('array length');
      return Array.from({ length: count }, () => this.value(strings, depth + 1));
    }
    if (tag === BINARY_TAG.map) {
      const count = this.u16('mapping length');
      const value = {};
      for (let index = 0; index < count; index += 1) {
        const key = this.#string(strings, this.u16('mapping key'));
        if (Object.hasOwn(value, key)) throw new Error(`${this.#label} binary document repeats mapping key '${key}'`);
        Object.defineProperty(value, key, {
          value: this.value(strings, depth + 1), enumerable: true, writable: true, configurable: true,
        });
      }
      return value;
    }
    throw new Error(`${this.#label} binary document has unknown value tag ${tag}`);
  }

  done() {
    if (this.#offset !== this.#bytes.length) throw new Error(`${this.#label} binary document has trailing bytes`);
  }

  #string(strings, index) {
    if (index >= strings.length) throw new Error(`${this.#label} binary document has invalid string reference ${index}`);
    return strings[index];
  }

  #need(length, name) {
    if (this.#offset + length > this.#bytes.length) throw new Error(`${this.#label} binary document is truncated at ${name}`);
  }
}

function u16Buffer(value) { return Buffer.from(u16Bytes(value)); }
function u16Bytes(value) { return [value & 0xff, (value >>> 8) & 0xff]; }
function isPlainObject(value) { return Boolean(value) && Object.getPrototypeOf(value) === Object.prototype; }

function promotedRuntimeCapabilities(mask) {
  if (!TI86_SCHOOLCALC_RUNTIME_PROMOTION_ENABLED) return [];
  const bits = TI86_SCHOOLCALC_RUNTIME_MODULE_BITS;
  const has = (required) => (mask & required) === required;
  const capabilities = [];
  if (has(bits.standardLearning)) capabilities.push('reader@1', 'examples@1', 'scan-action@1');
  if (has(bits.standardLearning | bits.resultQueue)) {
    capabilities.push('flashcards@1', 'learning-probe@1', 'problems@1', 'quiz@1', 'response.choice@1');
  }
  if (has(bits.resultQr)) capabilities.push('qr-output@1');
  return capabilities;
}

function defaultCapabilityReport() {
  return {
    capabilities: TI86_SCHOOLCALC_CODEC_CAPABILITIES,
    limits: {
      maxArtifactBytes: DEFAULT_MAX_ARTIFACT_BYTES,
      artifactTargetBytes: TI86_SCHOOLCALC_LIMITS.lessonTargetBytes,
      catalogStateTargetBytes: TI86_SCHOOLCALC_LIMITS.catalogStateTargetBytes,
      catalogStateMaxBytes: TI86_SCHOOLCALC_LIMITS.catalogStateMaxBytes,
      catalogRecordTargetBytes: TI86_SCHOOLCALC_LIMITS.catalogRecordTargetBytes,
      catalogRecordMaxBytes: TI86_SCHOOLCALC_LIMITS.catalogRecordMaxBytes,
      queueTargetBytes: TI86_SCHOOLCALC_LIMITS.queueTargetBytes,
      queueMaxBytes: TI86_SCHOOLCALC_LIMITS.queueMaxBytes,
      queueMaxRecords: TI86_SCHOOLCALC_LIMITS.queueMaxRecords,
      deliveryRequestTargetBytes: TI86_SCHOOLCALC_LIMITS.deliveryRequestTargetBytes,
      deliveryRequestMaxBytes: TI86_SCHOOLCALC_LIMITS.deliveryRequestMaxBytes,
      deliveryRequestMaxRecords: TI86_SCHOOLCALC_LIMITS.deliveryRequestMaxRecords,
      learnerRosterTargetBytes: TI86_SCHOOLCALC_LIMITS.learnerRosterTargetBytes,
      learnerRosterMaxBytes: TI86_SCHOOLCALC_LIMITS.learnerRosterMaxBytes,
      learnerRosterMaxRecords: TI86_SCHOOLCALC_LIMITS.learnerRosterMaxRecords,
      progressProjectionTargetBytes: TI86_SCHOOLCALC_LIMITS.progressProjectionTargetBytes,
      progressProjectionMaxBytes: TI86_SCHOOLCALC_LIMITS.progressProjectionMaxBytes,
      interactionRequestTargetBytes: TI86_SCHOOLCALC_LIMITS.interactionRequestTargetBytes,
      interactionRequestMaxBytes: TI86_SCHOOLCALC_LIMITS.interactionRequestMaxBytes,
      interactionResponseTargetBytes: TI86_SCHOOLCALC_LIMITS.interactionResponseTargetBytes,
      interactionResponseMaxBytes: TI86_SCHOOLCALC_LIMITS.interactionResponseMaxBytes,
      acknowledgementMaxBytes: TI86_SCHOOLCALC_LIMITS.acknowledgementMaxBytes,
      syncManifestMaxBytes: TI86_SCHOOLCALC_LIMITS.syncManifestMaxBytes,
      nativeHandoffWorkspaceBytes: TI86_SCHOOLCALC_LIMITS.nativeSnapshotMaxBytes,
      reservedFreeBytes: TI86_SCHOOLCALC_LIMITS.freeReserveBytes,
      variableOverheadBytes: TI86_SCHOOLCALC_LIMITS.variableOverheadBytes,
      localStateCommitBytes: TI86_SCHOOLCALC_LIMITS.localStateCommitBytes,
      catalogCommitCopyCount: TI86_SCHOOLCALC_LIMITS.catalogCommitCopyCount,
      manifestCommitCopyCount: TI86_SCHOOLCALC_LIMITS.manifestCommitCopyCount,
      queueCommitCopyCount: TI86_SCHOOLCALC_LIMITS.queueCommitCopyCount,
      interactionResponseCommitCopyCount: TI86_SCHOOLCALC_LIMITS.interactionResponseCommitCopyCount,
    },
  };
}

function projectBundle(bundle, artifactId, nativeToolMapper) {
  return {
    schema: 'school.calc.ti86-package/v2',
    artifactId,
    address: bundle.address,
    context: structuredClone(bundle.context),
    lesson: {
      lessonId: bundle.lesson.lessonId,
      title: bundle.lesson.title,
      ...(bundle.lesson.shortTitle !== undefined ? { shortTitle: bundle.lesson.shortTitle } : {}),
      objectives: structuredClone(bundle.lesson.objectives ?? []),
      modules: bundle.lesson.modules.map((module) => projectModule(module, nativeToolMapper)),
    },
  };
}

function projectModule(module, nativeToolMapper) {
  const moduleForProjection = module.title === undefined && TI86_MODULE_FALLBACK_TITLES[module.type]
    ? { ...module, title: TI86_MODULE_FALLBACK_TITLES[module.type] }
    : module;
  const common = Object.fromEntries(['moduleId', 'type', 'title']
    .filter((key) => moduleForProjection[key] !== undefined)
    .map((key) => [key, moduleForProjection[key]]));
  if (module.type === 'lecture_notes') {
    return {
      ...common,
      documentId: module.documentId,
      pages: projectLearningDocumentPages(module.document.blocks),
    };
  }
  if (module.type === 'examples') {
    return { ...common, pages: projectExamplePages(module.examples) };
  }
  if (module.type === 'tool') {
    return {
      ...common,
      capability: module.capability,
      nativePlan: nativeToolMapper.map(module),
    };
  }
  if (module.bank) {
    const revealAnswers = module.type === 'flashcards';
    const learningProbe = module.type === 'learning_probe';
    const includeAnswerKey = module.type === 'problems' || module.type === 'quiz' || learningProbe;
    return {
      ...common,
      bankId: module.bankId,
      ...(module.mode ? { mode: module.mode } : {}),
      ...(module.passingPercent ? { passingPercent: module.passingPercent } : {}),
      ...(learningProbe ? {
        phase: module.phase,
        difficulty: module.difficulty,
        conceptIds: structuredClone(module.conceptIds),
        feedback: structuredClone(module.feedback),
      } : {}),
      ...(module.remediation ? {
        remediation: {
          enabled: module.remediation.enabled,
          launch: module.remediation.launch,
          trigger: structuredClone(module.remediation.trigger),
          masteryTargetPercent: module.remediation.mastery.targetPercent,
        },
      } : {}),
      bank: {
        id: module.bank.id,
        title: module.bank.title,
        items: module.bank.items.map((item) => projectQuestionItem(item, {
          revealAnswers,
          includeAnswerKey,
          includeFeedback: learningProbe,
        })),
      },
    };
  }
  return structuredClone(module);
}

/**
 * Validate the parts of a neutral bundle that compiler v2 projects into the
 * fixed TI-86 reader viewport. This belongs to the adapter: School content is
 * not globally constrained to ASCII or calculator-sized pages.
 */
function ti86ProjectionReasons(modules, nativeToolMapper) {
  const reasons = [];
  modules.forEach((module, moduleIndex) => {
    const at = `module ${moduleIndex}`;
    if (module?.type === 'tool') {
      reasons.push(...nativeToolMapper.reasons(module).map((reason) => `${at} ${reason}`));
      return;
    }
    if (module?.type === 'lecture_notes') {
      if (!Array.isArray(module.document?.blocks) || module.document.blocks.length === 0) {
        reasons.push(`${at} lecture_notes has no resolved document blocks`);
        return;
      }
      module.document.blocks.forEach((block, blockIndex) => {
        const blockAt = `${at} block ${blockIndex}`;
        if (block?.type === 'scan_action') {
          const labelReason = ti86TextReason(block.label, `${blockAt} label`);
          if (labelReason) reasons.push(labelReason);
          else if (paginateReaderText(block.label).length !== 1) {
            reasons.push(`${blockAt} scan_action label exceeds one TI-86 reader page`);
          }
          // Catalog compatibility runs on the neutral bundle before a
          // device-bound token exists. If a token is present at compilation,
          // however, it must be the exact opaque action form.
          if (block.token !== undefined && !ACTION_TOKEN.test(block.token)) {
            reasons.push(`${blockAt} scan_action has an invalid server-issued token`);
          }
          return;
        }
        if (!READER_BLOCK_TYPES.has(block?.type)) {
          reasons.push(`${blockAt} type '${block?.type ?? 'missing'}' has no TI-86 reader projection`);
          return;
        }
        learningBlockSegments(block).forEach((text, segmentIndex) => {
          const reason = ti86TextReason(text, `${blockAt} segment ${segmentIndex}`);
          if (reason) reasons.push(reason);
        });
      });
      return;
    }
    if (module?.type === 'examples') {
      if (!Array.isArray(module.examples) || module.examples.length === 0) {
        reasons.push(`${at} examples has no entries`);
        return;
      }
      module.examples.forEach((example, exampleIndex) => {
        exampleSegments(example).forEach((text, segmentIndex) => {
          const reason = ti86TextReason(text, `${at} example ${exampleIndex} segment ${segmentIndex}`);
          if (reason) reasons.push(reason);
        });
      });
      return;
    }
    if (['problems', 'flashcards', 'quiz', 'learning_probe'].includes(module?.type)) {
      const items = module.bank?.items;
      if (!Array.isArray(items) || items.length === 0) {
        reasons.push(`${at} ${module.type} has no resolved question-bank items`);
        return;
      }
      if (items.length > ASSESSMENT_MAX_ITEMS) {
        reasons.push(`${at} has ${items.length} items; TI-86 v0 supports at most ${ASSESSMENT_MAX_ITEMS}`);
      }
      if (module.type === 'learning_probe' && items.length > LEARNING_PROBE_MAX_ITEMS) {
        reasons.push(`${at} has ${items.length} items; TI-86 learning probes support at most ${LEARNING_PROBE_MAX_ITEMS}`);
      }
      items.forEach((item, itemIndex) => {
        const itemAt = `${at} item ${itemIndex}`;
        if (item?.type !== 'multiple_choice') {
          reasons.push(`${itemAt} type '${item?.type ?? 'missing'}' has no TI-86 v0 assessment projection`);
          return;
        }
        const promptReason = ti86TextReason(item.prompt, `${itemAt} prompt`);
        if (promptReason) reasons.push(promptReason);
        if (!Array.isArray(item.choices)
            || item.choices.length < 2
            || item.choices.length > ASSESSMENT_MAX_CHOICES) {
          reasons.push(`${itemAt} must contain 2..${ASSESSMENT_MAX_CHOICES} choices for TI-86 F1-F5 input`);
          return;
        }
        item.choices.forEach((choice, choiceIndex) => {
          const choiceAt = `${itemAt} choice ${choiceIndex}`;
          const choiceReason = ti86TextReason(choice, choiceAt);
          if (choiceReason) reasons.push(choiceReason);
          else if (choice.length > ASSESSMENT_CHOICE_MAX_CHARS) {
            reasons.push(`${choiceAt} exceeds the ${ASSESSMENT_CHOICE_MAX_CHARS}-character visible TI-86 choice bound`);
          }
        });
        if (module.type !== 'flashcards'
            && !item.choices.some((choice) => choice === item.answer)) {
          reasons.push(`${itemAt} answer does not identify one locally scoreable choice`);
        }
        if (module.type === 'learning_probe') {
          const explanationReason = ti86TextReason(item.feedback?.explanation, `${itemAt} feedback explanation`);
          if (explanationReason) reasons.push(explanationReason);
        }
      });
      return;
    }
    reasons.push(`${at} type '${module?.type ?? 'missing'}' has no TI-86 v0 runtime`);
  });
  return reasons;
}

function projectLearningDocumentPages(blocks) {
  return blocks.flatMap((block, sourceIndex) => {
    if (block.type === 'scan_action') {
      if (!ACTION_TOKEN.test(block.token || '')) {
        throw new Error(`TI-86 scan action '${block.actionId}' has no valid server-issued token`);
      }
      const pages = paginateReaderText(block.label);
      if (pages.length !== 1) throw new Error(`TI-86 scan action '${block.actionId}' label requires more than one page`);
      return [{
        sourceIndex,
        segmentIndex: 0,
        partIndex: 0,
        text: pages[0],
        kind: 'scan_action',
        actionToken: block.token,
        qrModules: encodeTi86SchoolActionQr(block.token),
      }];
    }
    return projectReaderSegments(learningBlockSegments(block), sourceIndex);
  });
}

function projectExamplePages(examples) {
  return examples.flatMap((example, sourceIndex) => projectReaderSegments(
    exampleSegments(example), sourceIndex,
  ));
}

function projectReaderSegments(segments, sourceIndex) {
  return segments.flatMap((text, segmentIndex) => paginateReaderText(text)
    .map((pageText, partIndex) => ({ sourceIndex, segmentIndex, partIndex, text: pageText })));
}

function learningBlockSegments(block) {
  if (block.type === 'heading' || block.type === 'prose') return [block.text];
  if (block.type === 'definition') return [`${block.term}: ${block.definition}`];
  if (block.type === 'formula') {
    return [block.text, ...(block.variables ?? []).map(({ symbol, meaning }) => `${symbol}: ${meaning}`)];
  }
  if (block.type === 'worked_example') {
    return [
      `Example\n${block.prompt}`,
      ...block.steps.map((step, index) => `Step ${index + 1}\n${step}`),
      ...(block.result ? [`Result\n${block.result}`] : []),
    ];
  }
  if (block.type === 'callout') return [`${block.tone.toUpperCase()}: ${block.text}`];
  return [];
}

function exampleSegments(example) {
  return [
    `Example\n${example.prompt}`,
    ...example.steps.map((step, index) => `Step ${index + 1}\n${step}`),
  ];
}

function ti86TextReason(raw, at) {
  if (typeof raw !== 'string' || !raw.trim()) return `${at} has no renderable text`;
  const text = raw.replace(/\r\n?/g, '\n');
  const unsupported = [...text].find((character) => {
    const code = character.codePointAt(0);
    return character !== '\n' && (code < 0x20 || code > 0x7e);
  });
  if (!unsupported) return null;
  return `${at} contains unsupported TI-86 character U+${unsupported.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * Convert one semantic text segment into complete 23-column by five-line
 * pages. Explicit newlines are retained, wrapping prefers spaces, and no page
 * can exceed the Z80 reader's 120-byte buffer (the maximum here is 119).
 */
function paginateReaderText(raw) {
  return paginateText(raw, {
    columns: READER_PAGE_COLUMNS,
    linesPerPage: READER_PAGE_LINES,
    maxBytes: READER_PAGE_MAX_BYTES,
    label: 'TI-86 reader paginator',
  });
}

function paginateAssessmentPrompt(raw) {
  return paginateText(raw, {
    columns: ASSESSMENT_PROMPT_PAGE_COLUMNS,
    linesPerPage: ASSESSMENT_PROMPT_PAGE_LINES,
    maxBytes: ASSESSMENT_PROMPT_PAGE_MAX_BYTES,
    label: 'TI-86 assessment prompt paginator',
  });
}

function paginateText(raw, {
  columns,
  linesPerPage,
  maxBytes,
  label,
}) {
  const normalized = raw.replace(/\r\n?/g, '\n').trim();
  const lines = [];
  for (const authoredLine of normalized.split('\n')) {
    let remaining = authoredLine.trim();
    if (!remaining) {
      lines.push('');
      continue;
    }
    while (remaining.length > columns) {
      const candidate = remaining.slice(0, columns + 1);
      let boundary = candidate.lastIndexOf(' ');
      if (boundary <= 0 || boundary > columns) boundary = columns;
      lines.push(remaining.slice(0, boundary).trimEnd());
      remaining = remaining.slice(boundary).trimStart();
    }
    lines.push(remaining);
  }
  while (lines[0] === '') lines.shift();
  while (lines.at(-1) === '') lines.pop();

  const pages = [];
  for (let offset = 0; offset < lines.length; offset += linesPerPage) {
    const page = lines.slice(offset, offset + linesPerPage).join('\n');
    if (Buffer.byteLength(page, 'ascii') > maxBytes) {
      throw new Error(`${label} exceeded its fixed page buffer`);
    }
    pages.push(page);
  }
  return pages;
}

function projectQuestionItem(item, { revealAnswers, includeAnswerKey, includeFeedback = false }) {
  const projected = {
    id: item.id,
    type: item.type,
    promptPages: paginateAssessmentPrompt(item.prompt),
    choices: structuredClone(item.choices),
  };
  if (revealAnswers) projected.answerPages = paginateReaderText(item.answer);
  if (includeFeedback) projected.feedbackPages = paginateReaderText(item.feedback.explanation);
  if (includeAnswerKey) {
    const answerIndex = item.choices.findIndex((choice) => choice === item.answer);
    if (answerIndex < 0) throw new Error(`TI-86 item '${item.id}' has no locally scoreable answer`);
    // One-based to match the A..E values persisted by the Z80 assessment
    // draft. It is hidden by the normal UI, but intentionally not secret.
    projected.correctChoice = answerIndex + 1;
  }
  return projected;
}

function validateResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('TI-86 result must be a mapping');
  for (const field of ['at', 'timestamp', 'occurredAt', 'completedAt', 'receivedAt', 'recordedAt']) {
    if (Object.hasOwn(result, field)) {
      throw new Error(`TI-86 result cannot claim wall-clock field '${field}' (the TI-86 has no RTC)`);
    }
  }
  if (result.schema !== 'school.calc.result/v1') throw new Error('TI-86 result has an unsupported schema');
  if (!COMPACT_DEVICE_ID.test(result.deviceId || '')) throw new Error('TI-86 result has an invalid deviceId');
  if (!Number.isSafeInteger(result.learnerKey) || result.learnerKey < 1 || result.learnerKey > 0xffff) {
    throw new Error('TI-86 result has an invalid learnerKey');
  }
  if (!Number.isSafeInteger(result.sequence) || result.sequence < 0 || result.sequence > 0xff_ffff) {
    throw new Error('TI-86 result has an invalid sequence');
  }
  if (!artifactKey(result.artifactId)) throw new Error('TI-86 result has an invalid artifactId');
  if (!Number.isInteger(result.moduleIndex) || result.moduleIndex < 0 || result.moduleIndex > RESULT_MODULE_MASK) {
    throw new Error('TI-86 result has an invalid moduleIndex');
  }
  if (!Object.hasOwn(RESULT_KIND, result.kind)) throw new Error('TI-86 result has an invalid kind');
  if (result.kind === 'progress') {
    if (!result.progress || !Object.hasOwn(PROGRESS_STATUS, result.progress.status)) {
      throw new Error('TI-86 progress result has an invalid status');
    }
    for (const field of ['position', 'total']) {
      if (!Number.isInteger(result.progress[field]) || result.progress[field] < 0 || result.progress[field] > 0xffff) {
        throw new Error(`TI-86 progress result has an invalid ${field}`);
      }
    }
    if (result.progress.position > result.progress.total) {
      throw new Error('TI-86 progress position exceeds total');
    }
    return;
  }
  if (!Array.isArray(result.responses) || result.responses.length === 0 || result.responses.length > 255) {
    throw new Error('TI-86 result must contain 1..255 responses');
  }
  const ids = new Set();
  result.responses.forEach((response, index) => {
    if (!response || typeof response !== 'object' || Array.isArray(response)) throw new Error(`TI-86 result response ${index} must be a mapping`);
    if (!Number.isInteger(response.itemIndex) || response.itemIndex < 0 || response.itemIndex > 255) {
      throw new Error(`TI-86 result response ${index} has an invalid itemIndex`);
    }
    if (ids.has(response.itemIndex)) throw new Error(`TI-86 result repeats itemIndex ${response.itemIndex}`);
    ids.add(response.itemIndex);
    if (response.given === undefined || response.given === null) {
      throw new Error(`TI-86 result response ${response.itemIndex} has no given value`);
    }
    if (!isCompactGiven(response.given)) {
      throw new Error(`TI-86 result response ${response.itemIndex} has an unsupported value`);
    }
    if (response.probe !== undefined) validateCompactProbeTrace(response, index);
  });
  const probeCount = result.responses.filter((response) => response.probe !== undefined).length;
  if (probeCount !== 0 && probeCount !== result.responses.length) {
    throw new Error('TI-86 result cannot mix probe and ordinary responses');
  }
  if (probeCount > LEARNING_PROBE_MAX_ITEMS) {
    throw new Error(`TI-86 probe result exceeds ${LEARNING_PROBE_MAX_ITEMS} items`);
  }
  validateCompactLocalScore(result.localScore, result.responses.length);
  if (result.adaptiveStudy !== undefined) validateAdaptiveStudyResult(result);
}

function validateAdaptiveStudyResult(result) {
  const study = result.adaptiveStudy;
  if (!study || typeof study !== 'object' || Array.isArray(study)) {
    throw new Error('TI-86 adaptive study result must be a mapping');
  }
  if (!ADAPTIVE_SESSION_CODE.test(study.sessionCode || '')) {
    throw new Error('TI-86 adaptive study result has an invalid six-digit sessionCode');
  }
  if (!Array.isArray(study.cards) || study.cards.length < 1 || study.cards.length > 255) {
    throw new Error('TI-86 adaptive study result must contain 1..255 card summaries');
  }
  study.cards.forEach((card, index) => {
    if (!card || typeof card !== 'object' || Array.isArray(card)
        || !Object.hasOwn(ADAPTIVE_CARD_RATING, card.rating)
        || !Number.isInteger(card.exposureCount)
        || card.exposureCount < 1 || card.exposureCount > 4) {
      throw new Error(`TI-86 adaptive study card ${index} has invalid rating/exposure telemetry`);
    }
  });
  if (!Array.isArray(study.quizChoices) || study.quizChoices.length < 1
      || study.quizChoices.length > study.cards.length
      || study.quizChoices.some((choice) => !Number.isInteger(choice) || choice < 1 || choice > 5)) {
    throw new Error('TI-86 adaptive study result has invalid A-E quiz choices');
  }
  if (result.responses.length !== study.quizChoices.length
      || result.responses.some((response, index) => (
        response.itemIndex !== index || response.given !== study.quizChoices[index]
      ))) {
    throw new Error('TI-86 adaptive study responses must exactly match ordered quizChoices');
  }
}

function encodeCompactResultRecord(result) {
  validateResult(result);
  const hasProbeTelemetry = result.kind !== 'progress'
    && result.responses.some((response) => response.probe !== undefined);
  // Probe evidence is part of the learning record, not an optional transport
  // optimization. Never fall back to the generic response encoding (which
  // cannot carry retries/feedback/continuation) when compact ordering breaks.
  if (hasProbeTelemetry && !canPackProbeResponses(result.responses)) {
    throw new Error('TI-86 probe responses must be ordered by itemIndex for compact transport');
  }
  const body = [];
  body.push(RESULT_KIND[result.kind] | result.moduleIndex);
  pushShortAscii(body, result.deviceId, 'deviceId');
  pushU24(body, result.sequence);
  pushU16(body, result.learnerKey);
  body.push(...Buffer.from(artifactKey(result.artifactId), 'ascii'));

  if (result.kind === 'progress') {
    body.push(PROGRESS_STATUS[result.progress.status]);
    pushU16(body, result.progress.position);
    pushU16(body, result.progress.total);
  } else if (result.adaptiveStudy) {
    const { sessionCode, cards, quizChoices } = result.adaptiveStudy;
    body.push(ADAPTIVE_RESULT_MODE, quizChoices.length, ...Buffer.from(sessionCode, 'ascii'), cards.length);
    pushPackedNibbles(body, cards.map(({ rating, exposureCount }) => (
      (ADAPTIVE_CARD_RATING[rating] << 2) | (exposureCount - 1)
    )));
    pushPackedNibbles(body, quizChoices);
    body.push(result.localScore.correct);
  } else if (hasProbeTelemetry) {
    body.push(3, result.responses.length);
    for (const response of result.responses) {
      const attempts = response.probe.attempts;
      body.push((attempts[0] << 4) | (attempts[1] ?? 0));
      body.push(((attempts[2] ?? 0) << 4)
        | (response.probe.feedbackViewed ? 0x02 : 0)
        | (response.probe.continued ? 0x01 : 0));
    }
    body.push(result.localScore.correct);
  } else if (canPackOrderedChoices(result.responses)) {
    body.push(1, result.responses.length);
    for (let index = 0; index < result.responses.length; index += 2) {
      const high = result.responses[index].given & 0x0f;
      const low = result.responses[index + 1]?.given ?? 0;
      body.push((high << 4) | (low & 0x0f));
    }
    body.push(result.localScore.correct);
  } else {
    body.push(2, result.responses.length);
    for (const response of result.responses) {
      body.push(response.itemIndex);
      pushGiven(body, response.given);
    }
    body.push(result.localScore.correct);
  }

  if (body.length > MAX_ENVELOPE_PAYLOAD) throw new Error(`TI-86 result body is too large (${body.length} bytes)`);
  const bytes = Buffer.alloc(7 + body.length + 2);
  bytes.write('SCR1', 0, 4, 'ascii');
  bytes[4] = RECORD_VERSION;
  bytes.writeUInt16LE(body.length, 5);
  Buffer.from(body).copy(bytes, 7);
  bytes.writeUInt16LE(crc16Ccitt(bytes.subarray(0, -2)), bytes.length - 2);
  if (result.adaptiveStudy && bytes.length > ADAPTIVE_RESULT_MAX_BYTES) {
    throw new Error(`TI-86 adaptive study result exceeds ${ADAPTIVE_RESULT_MAX_BYTES}-byte QR ceiling`);
  }
  return bytes;
}

function decodeCompactResultRecord(input) {
  const bytes = compactResultBytes(input);
  if (bytes.length < 9) throw new Error('SCR1 record is truncated');
  if (bytes.toString('ascii', 0, 4) !== 'SCR1') throw new Error('SCR1 record has the wrong magic');
  if (bytes[4] !== RECORD_VERSION) throw new Error(`SCR1 record uses unsupported version ${bytes[4]}`);
  const bodyLength = bytes.readUInt16LE(5);
  if (bytes.length !== 7 + bodyLength + 2) throw new Error('SCR1 record length does not match its header');
  const expectedCrc = bytes.readUInt16LE(bytes.length - 2);
  const actualCrc = crc16Ccitt(bytes.subarray(0, -2));
  if (actualCrc !== expectedCrc) throw new Error('SCR1 record checksum failed');

  const reader = new ByteReader(bytes.subarray(7, -2));
  const kindAndModule = reader.u8('kind and module');
  const kind = (kindAndModule & RESULT_KIND.progress) === 0 ? 'responses' : 'progress';
  const moduleIndex = kindAndModule & RESULT_MODULE_MASK;
  const deviceId = reader.shortAscii('deviceId');
  const sequence = reader.u24('sequence');
  const learnerKey = reader.u16('learnerKey');
  if (learnerKey === 0) throw new Error('SCR1 record cannot persist Guest work');
  const artifactId = `${ARTIFACT_PREFIX}${reader.fixedAscii(10, 'artifact key')}`;
  const common = {
    schema: 'school.calc.result/v1', kind, deviceId, sequence, learnerKey, artifactId, moduleIndex,
  };

  if (kind === 'progress') {
    const statusCode = reader.u8('progress status');
    const status = PROGRESS_STATUS_BY_CODE[statusCode];
    if (!status) throw new Error(`SCR1 record has unknown progress status ${statusCode}`);
    const decoded = {
      ...common,
      progress: { status, position: reader.u16('progress position'), total: reader.u16('progress total') },
    };
    reader.done();
    return decoded;
  }

  const mode = reader.u8('response mode');
  const count = reader.u8('response count');
  if (count === 0) throw new Error('SCR1 record has no responses');
  const responses = [];
  if (mode === 1) {
    for (let index = 0; index < count; index += 2) {
      const packed = reader.u8('packed choices');
      responses.push({ itemIndex: index, given: (packed >>> 4) & 0x0f });
      if (index + 1 < count) responses.push({ itemIndex: index + 1, given: packed & 0x0f });
    }
  } else if (mode === 2) {
    for (let index = 0; index < count; index += 1) {
      responses.push({ itemIndex: reader.u8('itemIndex'), given: reader.given() });
    }
  } else if (mode === 3) {
    if (count > LEARNING_PROBE_MAX_ITEMS) throw new Error('SCR1 probe response count exceeds its bound');
    for (let index = 0; index < count; index += 1) {
      const firstTwo = reader.u8('probe response choices 1 and 2');
      const thirdAndFlags = reader.u8('probe response choice 3 and flags');
      if ((thirdAndFlags & 0x0c) !== 0) throw new Error('SCR1 probe response has reserved flags');
      const attempts = [(firstTwo >>> 4) & 0x0f];
      const second = firstTwo & 0x0f;
      const third = (thirdAndFlags >>> 4) & 0x0f;
      if (second) attempts.push(second);
      if (third) attempts.push(third);
      const response = {
        itemIndex: index,
        given: attempts[0],
        probe: {
          attempts,
          feedbackViewed: Boolean(thirdAndFlags & 0x02),
          continued: Boolean(thirdAndFlags & 0x01),
        },
      };
      validateCompactProbeTrace(response, index);
      responses.push(response);
    }
  } else if (mode === ADAPTIVE_RESULT_MODE) {
    const sessionCode = reader.fixedAscii(6, 'adaptive session code');
    if (!ADAPTIVE_SESSION_CODE.test(sessionCode)) {
      throw new Error('SCR1 adaptive result has an invalid six-digit session code');
    }
    const cardCount = reader.u8('adaptive card count');
    const quizCount = count;
    if (cardCount < 1 || quizCount < 1 || quizCount > cardCount) {
      throw new Error('SCR1 adaptive result has invalid card/quiz counts');
    }
    const cards = readPackedNibbles(reader, cardCount, 'adaptive cards').map((nibble, index) => {
      const rating = ADAPTIVE_CARD_RATING_BY_CODE[(nibble >>> 2) & 0x03];
      const exposureCount = (nibble & 0x03) + 1;
      if (!rating) throw new Error(`SCR1 adaptive card ${index} has an invalid rating`);
      return { rating, exposureCount };
    });
    const quizChoices = readPackedNibbles(reader, quizCount, 'adaptive quiz choices');
    if (quizChoices.some((choice) => choice < 1 || choice > 5)) {
      throw new Error('SCR1 adaptive result has an invalid A-E quiz choice');
    }
    quizChoices.forEach((given, itemIndex) => responses.push({ itemIndex, given }));
    common.adaptiveStudy = { sessionCode, cards, quizChoices };
  } else {
    throw new Error(`SCR1 record has unknown response mode ${mode}`);
  }
  const correct = reader.u8('local score correct');
  reader.done();
  const localScore = {
    correct,
    total: count,
    percent: Math.round((correct / count) * 100),
    basis: 'embedded_answer_key',
  };
  validateCompactLocalScore(localScore, count);
  const decoded = { ...common, responses, localScore };
  validateResult(decoded);
  return decoded;
}

function pushPackedNibbles(target, values) {
  for (let index = 0; index < values.length; index += 2) {
    target.push(((values[index] & 0x0f) << 4) | ((values[index + 1] ?? 0) & 0x0f));
  }
}

function readPackedNibbles(reader, count, label) {
  const values = [];
  for (let index = 0; index < count; index += 2) {
    const packed = reader.u8(label);
    values.push((packed >>> 4) & 0x0f);
    if (index + 1 < count) values.push(packed & 0x0f);
    else if ((packed & 0x0f) !== 0) throw new Error(`SCR1 ${label} has non-zero padding`);
  }
  return values;
}

function validateCompactLocalScore(score, responseCount) {
  if (!score || typeof score !== 'object' || Array.isArray(score)
      || !Number.isInteger(score.correct) || score.correct < 0 || score.correct > responseCount
      || score.total !== responseCount
      || !Number.isInteger(score.percent) || score.percent < 0 || score.percent > 100
      || score.percent !== Math.round((score.correct / responseCount) * 100)
      || (score.basis !== undefined && score.basis !== 'embedded_answer_key')) {
    throw new Error('TI-86 result has an invalid embedded-answer-key score');
  }
}

function compactResultBytes(input) {
  if (typeof input === 'string') {
    if (!input.startsWith(RESULT_QR_PREFIX)) throw new Error('SCR1 QR text must start with sch:r1:');
    return base32Decode(input.slice(RESULT_QR_PREFIX.length));
  }
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  throw new Error('SCR1 record must be bytes or sch:r1: QR text');
}

function artifactKey(artifactId) {
  if (typeof artifactId !== 'string' || !artifactId.startsWith(ARTIFACT_PREFIX)) return null;
  const key = artifactId.slice(ARTIFACT_PREFIX.length);
  return ARTIFACT_KEY.test(key) ? key : null;
}

function ti86ProfileLabel(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('TI-86 learner profile label is required');
  const ascii = value.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20);
  if (!ascii) throw new Error('TI-86 learner profile label has no renderable characters');
  return ascii;
}

function ti86ProgressLabel(value, maximum) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('TI-86 progress label is required');
  const ascii = value.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
  if (!ascii) throw new Error('TI-86 progress label has no renderable characters');
  return ascii;
}

/**
 * Allocate a fair, globally bounded prefix of each learner's preorder tree.
 * Prefixes preserve every encoded parent; round-robin allocation prevents a
 * shared calculator's first learner from consuming the whole SCG1 budget.
 */
function allocateTi86ProgressHistories(profiles) {
  const candidates = profiles.map((profile, profileIndex) => (
    flattenTi86ProgressHistory(profile?.curriculumHistory, profileIndex)
  ));
  const selected = candidates.map(() => []);
  let total = 0;
  for (let position = 0; position < PROGRESS_HISTORY_NODE_LIMIT
    && total < PROGRESS_HISTORY_TOTAL_NODE_LIMIT; position += 1) {
    for (let profileIndex = 0; profileIndex < candidates.length
      && total < PROGRESS_HISTORY_TOTAL_NODE_LIMIT; profileIndex += 1) {
      const node = candidates[profileIndex][position];
      if (!node) continue;
      selected[profileIndex].push(node);
      total += 1;
    }
  }
  return selected;
}

function flattenTi86ProgressHistory(history, profileIndex) {
  if (history === undefined || history === null) return [];
  if (!history || typeof history !== 'object' || Array.isArray(history)
      || !Array.isArray(history.roots)) {
    throw new Error(`TI-86 progress profile ${profileIndex} curriculumHistory is invalid`);
  }
  const nodes = [];
  const visit = (node, parentIndex) => {
    if (nodes.length >= PROGRESS_HISTORY_NODE_LIMIT) return;
    if (!node || typeof node !== 'object' || Array.isArray(node)
        || !PROGRESS_HISTORY_KIND[node.kind]
        || typeof node.id !== 'string' || !node.id.trim()
        || !Array.isArray(node.children)) {
      throw new Error(`TI-86 progress profile ${profileIndex} has an invalid curriculum-history node`);
    }
    const summary = normalizeProgressHistorySummary(node.summary, profileIndex);
    const ownIndex = nodes.length;
    const displayLabel = (node.label ?? node.id).replace(/[-_]+/g, ' ');
    nodes.push(Object.freeze({
      parentIndex,
      kind: node.kind,
      label: ti86ProgressLabel(displayLabel, PROGRESS_HISTORY_LABEL_MAX),
      pending: summary.pendingCount > 0,
      activityCount: Math.min(summary.activityCount, 0xffff),
      completionCount: Math.min(summary.completionCount, 0xffff),
      scorePercent: summary.scorePercent,
    }));
    node.children.forEach((child) => visit(child, ownIndex));
  };
  history.roots.forEach((root) => visit(root, null));
  return nodes;
}

function normalizeProgressHistorySummary(summary, profileIndex) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    throw new Error(`TI-86 progress profile ${profileIndex} curriculum-history summary is invalid`);
  }
  const activityCount = integerInRange(summary.activityCount, 0, 0xffff_ffff,
    `profile ${profileIndex} curriculum-history activityCount`);
  const completionCount = integerInRange(summary.completionCount, 0, 0xffff_ffff,
    `profile ${profileIndex} curriculum-history completionCount`);
  const pendingCount = integerInRange(summary.pendingCount, 0, 0xffff_ffff,
    `profile ${profileIndex} curriculum-history pendingCount`);
  const scorePercent = summary.scorePercent;
  if (scorePercent !== null && (!Number.isInteger(scorePercent) || scorePercent < 0 || scorePercent > 100)) {
    throw new Error(`TI-86 progress profile ${profileIndex} curriculum-history scorePercent is invalid`);
  }
  return { activityCount, completionCount, pendingCount, scorePercent };
}

function normalizeProgressSummary(summary, profileIndex) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    throw new Error(`TI-86 progress profile ${profileIndex} summary is invalid`);
  }
  const normalized = Object.fromEntries([
    'evidenceCount', 'engagementCount', 'responseCount', 'correctCount',
    'completionCount', 'activityCount', 'assessmentCount',
  ].map((field) => [field, integerInRange(summary[field], 0, 0xffff_ffff,
    `profile ${profileIndex} ${field}`)]));
  if (normalized.correctCount > normalized.responseCount) {
    throw new Error(`TI-86 progress profile ${profileIndex} correctCount exceeds responseCount`);
  }
  const expectedPercent = normalized.responseCount === 0
    ? null
    : Math.round((normalized.correctCount / normalized.responseCount) * 100);
  if (summary.scorePercent !== expectedPercent) {
    throw new Error(`TI-86 progress profile ${profileIndex} scorePercent is inconsistent`);
  }
  return { ...normalized, scorePercent: expectedPercent, lastActivityAt: summary.lastActivityAt ?? null };
}

function validateDecodedProgressSummary(summary) {
  if (summary.correctCount > summary.responseCount
      || (summary.responseCount === 0 && summary.scorePercent !== null)
      || (summary.responseCount > 0
        && summary.scorePercent !== Math.round((summary.correctCount / summary.responseCount) * 100))) {
    throw new Error('SCG1 progress projection has an inconsistent summary');
  }
}

function progressDate(timestamp, { required = false } = {}) {
  if (timestamp === null || timestamp === undefined) {
    if (required) throw new Error('TI-86 progress date is required');
    return ' '.repeat(10);
  }
  const parsed = new Date(timestamp);
  if (typeof timestamp !== 'string' || !Number.isFinite(parsed.valueOf())
      || parsed.toISOString() !== timestamp) {
    throw new Error('TI-86 progress date must be a canonical ISO-8601 timestamp');
  }
  return timestamp.slice(0, 10);
}

function readDate(value) {
  if (value === ' '.repeat(10)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)
      || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
    throw new Error('SCG1 progress projection has an invalid date');
  }
  return value;
}

function ti86ProgressActionKey(action, learnerKey) {
  return base32(createHash('sha256').update(canonicalJson({
    learnerKey,
    actionId: action.actionId,
    kind: action.kind,
    target: { type: action.target.type, id: action.target.id },
  })).digest()).slice(0, 10);
}

function invertNumericMap(value) {
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([name, code]) => [code, name])));
}

/** Deterministic TI variable locator derived from the durable artifact key. */
export function ti86ArtifactVariableName(artifactId) {
  const key = artifactKey(artifactId);
  if (!key) throw new Error('TI-86 artifact ID cannot produce a variable name');
  return `DP${key.slice(0, 6)}`;
}

function canPackOrderedChoices(responses) {
  return responses.every((response, index) => (
    response.itemIndex === index
    && response.probe === undefined
    && Number.isInteger(response.given)
    && response.given >= 0
    && response.given <= 5
  ));
}

function canPackProbeResponses(responses) {
  return responses.length > 0 && responses.every((response, index) => {
    try { validateCompactProbeTrace(response, index); } catch { return false; }
    return response.itemIndex === index;
  });
}

function validateCompactProbeTrace(response, index) {
  const trace = response?.probe;
  if (!trace || typeof trace !== 'object' || Array.isArray(trace)
      || !Array.isArray(trace.attempts) || trace.attempts.length < 1 || trace.attempts.length > 3
      || trace.attempts.some((choice) => !Number.isInteger(choice) || choice < 1 || choice > 5)
      || response.given !== trace.attempts[0]
      || typeof trace.feedbackViewed !== 'boolean'
      || typeof trace.continued !== 'boolean') {
    throw new Error(`TI-86 result response ${index} has invalid probe telemetry`);
  }
}

function isCompactGiven(value) {
  return typeof value === 'boolean'
    || (Number.isInteger(value) && value >= -0x8000_0000 && value <= 0x7fff_ffff)
    || (typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= 255);
}

function pushGiven(target, value) {
  if (value === false) target.push(0);
  else if (value === true) target.push(1);
  else if (Number.isInteger(value)) {
    target.push(2, value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
  } else if (typeof value === 'string') {
    const encoded = Buffer.from(value, 'utf8');
    target.push(3, encoded.length, ...encoded);
  } else {
    throw new Error('unsupported compact response value');
  }
}

function pushTi86InteractionSession(target, session, answer) {
  assertInteractionLocator(session?.sessionId, 'sessionId');
  const status = REMEDIATION_STATUS[session.status];
  const masteryPercent = integerInRange(session.masteryPercent, 0, 100, 'interaction masteryPercent');
  const targetPercent = integerInRange(session.targetPercent, 0, 100, 'interaction targetPercent');
  const nextClientSequence = session.cursor?.nextClientSequence ?? session.nextClientSequence;
  const latestServerSequence = session.cursor?.latestServerSequence
    ?? ((session.nextServerSequence ?? 1) - 1);
  const learnerControls = session.learnerControls;
  if (!status || !Number.isInteger(nextClientSequence) || nextClientSequence < 0
      || nextClientSequence > 0xffff || !Number.isInteger(latestServerSequence)
      || latestServerSequence < 0 || latestServerSequence > 0xffff
      || !Array.isArray(learnerControls) || learnerControls.length === 0
      || new Set(learnerControls).size !== learnerControls.length
      || learnerControls.some((control) => !INTERACTION_CONTROL[control])) {
    throw new Error('SCTR interaction response has invalid session state');
  }
  pushShortAscii(target, session.sessionId, 'interaction sessionId');
  target.push(status, masteryPercent, targetPercent);
  pushU16(target, nextClientSequence);
  pushU16(target, latestServerSequence);
  target.push(learnerControls.reduce(
    (mask, control) => mask | INTERACTION_CONTROL[control], 0,
  ));

  target.push(answer ? 1 : 0);
  if (answer) {
    if (!/^[A-E]$/.test(answer.choiceId || '') || typeof answer.correct !== 'boolean') {
      throw new Error('SCTR interaction response has an invalid answer result');
    }
    target.push(answer.choiceId.charCodeAt(0) - 64, answer.correct ? 1 : 0);
    pushMediumInteractionText(target, answer.rationale ?? '', 360, 'answer rationale');
  }

  const currentTurn = session.currentTurnId
    ? session.turns?.find(({ turnId }) => turnId === session.currentTurnId) ?? null
    : null;
  target.push(currentTurn ? 1 : 0);
  if (!currentTurn) return;
  assertInteractionLocator(currentTurn.turnId, 'turnId');
  if (!Number.isInteger(currentTurn.serverSequence) || currentTurn.serverSequence < 1
      || currentTurn.serverSequence > 0xffff || !Array.isArray(currentTurn.choices)
      || currentTurn.choices.length < 2 || currentTurn.choices.length > 5) {
    throw new Error('SCTR interaction response has an invalid current turn');
  }
  pushShortAscii(target, currentTurn.turnId, 'interaction turnId');
  pushU16(target, currentTurn.serverSequence);
  pushMediumInteractionText(target, currentTurn.body, 360, 'turn body');
  pushMediumInteractionText(target, currentTurn.prompt, 240, 'turn prompt');
  target.push(currentTurn.choices.length);
  currentTurn.choices.forEach((choice, index) => {
    if (choice?.id !== String.fromCharCode(65 + index)) {
      throw new Error('SCTR interaction choice IDs must be ordered A-E');
    }
    pushShortInteractionText(target, choice.label, 23, `choice ${choice.id}`);
  });
}

function readTi86InteractionSession(reader) {
  const sessionId = reader.shortAscii('sessionId');
  assertInteractionLocator(sessionId, 'sessionId');
  const status = REMEDIATION_STATUS_BY_CODE[reader.u8('session status')];
  const masteryPercent = reader.u8('masteryPercent');
  const targetPercent = reader.u8('targetPercent');
  const nextClientSequence = reader.u16('nextClientSequence');
  const latestServerSequence = reader.u16('latestServerSequence');
  const learnerControlMask = reader.u8('learner control mask');
  if (!status || masteryPercent > 100 || targetPercent > 100) {
    throw new Error('SCTR interaction response has invalid session state');
  }
  if (learnerControlMask === 0 || (learnerControlMask & ~INTERACTION_CONTROL_MASK) !== 0) {
    throw new Error('SCTR interaction response has invalid learner controls');
  }
  const learnerControls = Object.freeze(Object.entries(INTERACTION_CONTROL)
    .filter(([, bit]) => (learnerControlMask & bit) !== 0)
    .map(([control]) => control));
  const hasAnswer = reader.u8('answer presence');
  if (hasAnswer > 1) throw new Error('SCTR interaction response has invalid answer presence');
  let answer;
  if (hasAnswer) {
    const choice = reader.u8('answered choice');
    const correct = reader.u8('answer correctness');
    const rationale = readInteractionText(reader, reader.u16('rationale length'), 'rationale');
    if (choice < 1 || choice > 5 || correct > 1) {
      throw new Error('SCTR interaction response has invalid answer result');
    }
    answer = Object.freeze({
      choiceId: String.fromCharCode(64 + choice), correct: correct === 1, rationale,
    });
  }
  const hasTurn = reader.u8('turn presence');
  if (hasTurn > 1) throw new Error('SCTR interaction response has invalid turn presence');
  let currentTurn;
  if (hasTurn) {
    const turnId = reader.shortAscii('turnId');
    assertInteractionLocator(turnId, 'turnId');
    const serverSequence = reader.u16('turn serverSequence');
    const body = readInteractionText(reader, reader.u16('turn body length'), 'turn body');
    const prompt = readInteractionText(reader, reader.u16('turn prompt length'), 'turn prompt');
    const choiceCount = reader.u8('choice count');
    if (serverSequence === 0 || choiceCount < 2 || choiceCount > 5) {
      throw new Error('SCTR interaction response has invalid current turn');
    }
    const choices = [];
    for (let index = 0; index < choiceCount; index += 1) {
      choices.push(Object.freeze({
        id: String.fromCharCode(65 + index), functionKey: `F${index + 1}`,
        label: readInteractionText(reader, reader.u8(`choice ${index} length`), `choice ${index}`),
      }));
    }
    currentTurn = Object.freeze({ turnId, serverSequence, body, prompt, choices: Object.freeze(choices) });
  }
  return Object.freeze({
    sessionId, status, masteryPercent, targetPercent, learnerControls,
    cursor: Object.freeze({ nextClientSequence, latestServerSequence }),
    ...(answer ? { answer } : {}),
    ...(currentTurn ? { currentTurn } : {}),
  });
}

function assertInteractionLocator(value, label) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 95
      || [...Buffer.from(value, 'ascii')].some((byte) => byte < 0x20 || byte > 0x7e)
      || Buffer.from(value, 'ascii').toString('ascii') !== value) {
    throw new Error(`SchoolCalc interaction ${label} must be 1..95 printable ASCII characters`);
  }
}

function pushShortInteractionText(target, value, maximum, label) {
  const bytes = interactionTextBytes(value, maximum, label);
  if (bytes.length > 255) throw new Error(`SchoolCalc interaction ${label} exceeds one-byte length`);
  target.push(bytes.length, ...bytes);
}

function pushMediumInteractionText(target, value, maximum, label) {
  const bytes = interactionTextBytes(value, maximum, label);
  pushU16(target, bytes.length);
  target.push(...bytes);
}

function interactionTextBytes(value, maximum, label) {
  if (typeof value !== 'string') throw new Error(`SchoolCalc interaction ${label} must be text`);
  const bytes = Buffer.from(value, 'ascii');
  if (bytes.length > maximum || bytes.toString('ascii') !== value
      || [...bytes].some((byte) => byte !== 0x0a && (byte < 0x20 || byte > 0x7e))) {
    throw new Error(`SchoolCalc interaction ${label} must be at most ${maximum} printable ASCII/newline bytes`);
  }
  return bytes;
}

function readInteractionText(reader, length, label) {
  const bytes = reader.take(length, label);
  if ([...bytes].some((byte) => byte !== 0x0a && (byte < 0x20 || byte > 0x7e))) {
    throw new Error(`SCTR interaction response has invalid ${label}`);
  }
  return bytes.toString('ascii');
}

function interactionDefaultMessage(status) {
  return ({
    complete: 'Tutor response ready.',
    processing: 'Tutor is still working. Retry safely.',
    unavailable: 'That follow-up is no longer available.',
    retryable_error: 'Tutor is temporarily unavailable. Retry safely.',
  })[status];
}

function pushShortAscii(target, value, label) {
  const encoded = Buffer.from(value, 'ascii');
  if (encoded.length > 255 || encoded.toString('ascii') !== value) throw new Error(`${label} is not short ASCII`);
  target.push(encoded.length, ...encoded);
}

function pushU16(target, value) {
  target.push(value & 0xff, (value >>> 8) & 0xff);
}

function pushU24(target, value) {
  target.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff);
}

function pushU32(target, value) {
  target.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

class ByteReader {
  #bytes; #offset = 0;

  constructor(bytes) { this.#bytes = bytes; }

  u8(label) {
    this.#need(1, label);
    return this.#bytes[this.#offset++];
  }

  u16(label) {
    this.#need(2, label);
    const value = this.#bytes.readUInt16LE(this.#offset);
    this.#offset += 2;
    return value;
  }

  u24(label) {
    this.#need(3, label);
    const value = this.#bytes[this.#offset]
      | (this.#bytes[this.#offset + 1] << 8)
      | (this.#bytes[this.#offset + 2] << 16);
    this.#offset += 3;
    return value;
  }

  u32(label) {
    this.#need(4, label);
    const value = this.#bytes.readUInt32LE(this.#offset);
    this.#offset += 4;
    return value;
  }

  fixedAscii(length, label) {
    this.#need(length, label);
    const value = this.#bytes.toString('ascii', this.#offset, this.#offset + length);
    this.#offset += length;
    return value;
  }

  shortAscii(label) {
    return this.fixedAscii(this.u8(`${label} length`), label);
  }

  given() {
    const tag = this.u8('response value tag');
    if (tag === 0) return false;
    if (tag === 1) return true;
    if (tag === 2) {
      this.#need(4, 'integer response');
      const value = this.#bytes.readInt32LE(this.#offset);
      this.#offset += 4;
      return value;
    }
    if (tag === 3) {
      const length = this.u8('text response length');
      this.#need(length, 'text response');
      const value = this.#bytes.toString('utf8', this.#offset, this.#offset + length);
      this.#offset += length;
      return value;
    }
    throw new Error(`SCR1 record has unknown response value tag ${tag}`);
  }

  done() {
    if (this.#offset !== this.#bytes.length) throw new Error('SCR1 record has trailing bytes');
  }

  #need(length, label) {
    if (this.#offset + length > this.#bytes.length) throw new Error(`SCR1 record is truncated at ${label}`);
  }
}

class FixedRecordReader {
  #bytes; #offset = 0; #label;

  constructor(bytes, label) {
    this.#bytes = bytes;
    this.#label = label;
  }

  u8(label) {
    this.#need(1, label);
    return this.#bytes[this.#offset++];
  }

  u16(label) {
    this.#need(2, label);
    const value = this.#bytes.readUInt16LE(this.#offset);
    this.#offset += 2;
    return value;
  }

  u24(label) {
    this.#need(3, label);
    const value = this.#bytes[this.#offset]
      | (this.#bytes[this.#offset + 1] << 8)
      | (this.#bytes[this.#offset + 2] << 16);
    this.#offset += 3;
    return value;
  }

  u32(label) {
    this.#need(4, label);
    const value = this.#bytes.readUInt32LE(this.#offset);
    this.#offset += 4;
    return value;
  }

  take(length, label) {
    this.#need(length, label);
    const value = this.#bytes.subarray(this.#offset, this.#offset + length);
    this.#offset += length;
    return value;
  }

  fixedAscii(length, label) {
    const bytes = this.take(length, label);
    if ([...bytes].some((byte) => byte < 0x20 || byte > 0x7e)) {
      throw new Error(`${this.#label} record has non-ASCII ${label}`);
    }
    return bytes.toString('ascii');
  }

  shortAscii(label) { return this.fixedAscii(this.u8(`${label} length`), label); }

  done() {
    if (this.#offset !== this.#bytes.length) throw new Error(`${this.#label} record has trailing bytes`);
  }

  #need(length, label) {
    if (!Number.isInteger(length) || length < 0 || this.#offset + length > this.#bytes.length) {
      throw new Error(`${this.#label} record is truncated at ${label}`);
    }
  }
}

function envelopeBytes(input, expectedMagic) {
  if (typeof input === 'string') {
    const prefix = `${expectedMagic}:`;
    if (!input.startsWith(prefix)) throw new Error(`${expectedMagic} QR text has the wrong prefix`);
    return Buffer.from(input.slice(prefix.length), 'base64url');
  }
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  throw new Error(`${expectedMagic} record must be bytes or prefixed QR text`);
}

function canonicalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('SchoolCalc records cannot contain non-finite numbers');
    return value;
  }
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.keys(value).sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, canonicalize(value[key])]));
  }
  throw new Error(`SchoolCalc records cannot contain ${typeof value}`);
}

function integerInRange(value, min, max, name) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`TI-86 SchoolCalc device info has invalid ${name}`);
  }
  return value;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function base32(bytes) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let accumulator = 0;
  let output = '';
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += alphabet[(accumulator >>> bits) & 31];
    }
    accumulator &= (1 << bits) - 1;
  }
  if (bits > 0) output += alphabet[(accumulator << (5 - bits)) & 31];
  return output;
}

function base32Decode(value) {
  if (typeof value !== 'string' || !/^[A-Z2-7]+$/.test(value)) {
    throw new Error('SCR1 QR text contains invalid BASE32');
  }
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const output = [];
  let bits = 0;
  let accumulator = 0;
  for (const character of value) {
    accumulator = (accumulator << 5) | alphabet.indexOf(character);
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      output.push((accumulator >>> bits) & 0xff);
    }
    accumulator &= (1 << bits) - 1;
  }
  if (bits > 0 && accumulator !== 0) throw new Error('SCR1 QR text has non-zero BASE32 padding');
  return Buffer.from(output);
}

export default Ti86SchoolCalcCodec;
