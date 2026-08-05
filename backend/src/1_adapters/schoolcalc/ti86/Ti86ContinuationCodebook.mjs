import {
  encodeSchoolContinuationCode,
  normalizeSchoolContinuationModuleCode,
} from '#domains/school/continuationCode.mjs';
import { crc16Ccitt, ti86GenerationKey } from './Ti86SchoolCalcCodec.mjs';
import { TI86_SCHOOLCALC_LIMITS } from './Ti86SchoolCalcLimits.mjs';

/**
 * TI-86 adapter record for offline continuation-code resolution.
 *
 * The public six digits are produced by the domain's reversible permutation.
 * The calculator deliberately uses this small, installed target index instead
 * of implementing wide integer multiplication.  It therefore accepts only
 * routes whose learner and content are presently installed on that device.
 */
export const TI86_CONTINUATION_CODEBOOK_MAGIC = 'SCCO';
export const TI86_CONTINUATION_CODEBOOK_VARIABLE = 'DSCODE';
export const TI86_CONTINUATION_CODEBOOK_ENTRY_BYTES = 30;
const VERSION = 1;
const ARTIFACT_KEY = /^[A-Z2-7]{10}$/;

export function encodeTi86ContinuationCodebook({
  deviceId,
  generation,
  catalog,
  artifacts,
  learnerSlots,
} = {}) {
  if (typeof deviceId !== 'string' || !/^[A-Z0-9]{1,16}$/.test(deviceId)) {
    throw new Error('SCCO deviceId is invalid');
  }
  if (!catalog || typeof catalog !== 'object' || !Array.isArray(catalog.subjects)) {
    throw new Error('SCCO catalog is invalid');
  }
  if (!Array.isArray(artifacts)) throw new Error('SCCO artifacts must be an array');
  const slots = normalizeLearnerSlots(learnerSlots);
  const artifactsByAddress = new Map(artifacts.map((artifact) => {
    const artifactKey = artifactKeyOf(artifact);
    if (!artifact || typeof artifact.source?.address !== 'string' || !ARTIFACT_KEY.test(artifactKey || '')) {
      throw new Error('SCCO artifact metadata is invalid');
    }
    return [artifact.source.address, { ...artifact, artifactKey }];
  }));
  const entries = [];
  forEachModule(catalog, (module, address) => {
    if (module.continuationCode === undefined) return;
    const artifact = artifactsByAddress.get(address.path);
    if (!artifact) throw new Error(`SCCO route has no installed artifact: ${address.path}`);
    const moduleCode = normalizeSchoolContinuationModuleCode(module.continuationCode);
    for (const [learnerId, learner] of slots) {
      entries.push({
        code: encodeSchoolContinuationCode({ learnerSlot: learner.slot, moduleCode }),
        learnerId,
        learnerKey: learner.learnerKey,
        artifactKey: artifact.artifactKey,
        address: address.indexes,
      });
    }
  });
  if (entries.length > 255) throw new Error('SCCO exceeds 255 installed continuation routes');
  entries.sort((a, b) => a.code.localeCompare(b.code) || a.learnerKey - b.learnerKey);
  if (new Set(entries.map(({ code }) => code)).size !== entries.length) {
    throw new Error('SCCO contains colliding continuation routes');
  }
  const body = Buffer.alloc(1 + Buffer.byteLength(deviceId, 'ascii') + 10 + 1 + (entries.length * TI86_CONTINUATION_CODEBOOK_ENTRY_BYTES));
  let offset = 0;
  body[offset++] = Buffer.byteLength(deviceId, 'ascii');
  body.write(deviceId, offset, 'ascii'); offset += Buffer.byteLength(deviceId, 'ascii');
  body.write(ti86GenerationKey(generation), offset, 'ascii'); offset += 10;
  body[offset++] = entries.length;
  for (const entry of entries) {
    body.write(entry.code, offset, 'ascii'); offset += 6;
    body.writeUInt16LE(entry.learnerKey, offset); offset += 2;
    body.write(entry.artifactKey, offset, 'ascii'); offset += 10;
    for (const index of Object.values(entry.address)) {
      body.writeUInt16LE(index, offset); offset += 2;
    }
  }
  const record = encodeFixedEnvelope(TI86_CONTINUATION_CODEBOOK_MAGIC, body);
  if (record.length > TI86_SCHOOLCALC_LIMITS.continuationCodebookMaxBytes) {
    throw new Error(`SCCO exceeds its ${TI86_SCHOOLCALC_LIMITS.continuationCodebookMaxBytes}-byte storage limit`);
  }
  return record;
}

export function decodeTi86ContinuationCodebook(input) {
  const body = decodeFixedEnvelope(input, TI86_CONTINUATION_CODEBOOK_MAGIC);
  let offset = 0;
  const deviceIdLength = body[offset++];
  if (deviceIdLength < 1 || deviceIdLength > 16 || offset + deviceIdLength + 11 > body.length) {
    throw new Error('SCCO record is truncated at deviceId');
  }
  const deviceId = readAscii(body, offset, deviceIdLength, 'deviceId'); offset += deviceIdLength;
  if (!/^[A-Z0-9]{1,16}$/.test(deviceId)) throw new Error('SCCO record has an invalid deviceId');
  const generationKey = readAscii(body, offset, 10, 'generation key'); offset += 10;
  if (!ARTIFACT_KEY.test(generationKey)) throw new Error('SCCO record has an invalid generation key');
  const count = body[offset++];
  if (offset + (count * TI86_CONTINUATION_CODEBOOK_ENTRY_BYTES) !== body.length) {
    throw new Error('SCCO record has an invalid entry length');
  }
  const codes = new Set();
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const code = readAscii(body, offset, 6, `entry ${index} code`); offset += 6;
    const learnerKey = body.readUInt16LE(offset); offset += 2;
    const artifactKey = readAscii(body, offset, 10, `entry ${index} artifact key`); offset += 10;
    if (learnerKey === 0 || !/^\d{6}$/.test(code) || !ARTIFACT_KEY.test(artifactKey) || codes.has(code)) {
      throw new Error('SCCO record has an invalid or duplicate entry');
    }
    codes.add(code);
    const address = {};
    for (const field of ADDRESS_FIELDS) {
      address[field] = body.readUInt16LE(offset); offset += 2;
    }
    entries.push(Object.freeze({ code, learnerKey, artifactKey, address: Object.freeze(address) }));
  }
  return Object.freeze({
    schema: 'school.calc.ti86-continuation-codebook/v1', deviceId, generationKey,
    entries: Object.freeze(entries),
  });
}

export function resolveTi86ContinuationCode(record, code) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new Error('SCCO access code must be six digits');
  return decodeTi86ContinuationCodebook(record).entries.find((entry) => entry.code === code) ?? null;
}

const ADDRESS_FIELDS = Object.freeze([
  'catalogIndex', 'subjectIndex', 'courseIndex', 'unitIndex', 'lessonIndex', 'moduleIndex',
]);

function forEachModule(catalog, visit) {
  catalog.subjects.forEach((subject, subjectIndex) => subject.courses.forEach((course, courseIndex) => course.units.forEach((unit, unitIndex) => unit.lessons.forEach((lesson, lessonIndex) => {
    const path = [catalog.catalogId, subject.subjectId, course.courseId, unit.unitId, lesson.lessonId].join('/');
    lesson.modules.forEach((module, moduleIndex) => visit(module, {
      path,
      indexes: { catalogIndex: 0, subjectIndex, courseIndex, unitIndex, lessonIndex, moduleIndex },
    }));
  }))));
}

function normalizeLearnerSlots(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('SCCO learner slots must be a mapping');
  const entries = Object.entries(value).map(([learnerId, raw]) => {
    const slot = raw?.slot;
    const learnerKey = raw?.learnerKey;
    if (!learnerId || !Number.isInteger(slot) || slot < 0 || slot > 3
        || !Number.isInteger(learnerKey) || learnerKey < 1 || learnerKey > 0xffff) {
      throw new Error('SCCO learner slots are invalid');
    }
    return [learnerId, { slot, learnerKey }];
  });
  if (entries.length !== 4 || new Set(entries.map(([, value]) => value.slot)).size !== 4
      || new Set(entries.map(([, value]) => value.learnerKey)).size !== 4) {
    throw new Error('SCCO must contain four unique learner slots and keys');
  }
  return entries;
}

function encodeFixedEnvelope(magic, body) {
  const record = Buffer.alloc(7 + body.length + 2);
  record.write(magic, 0, 'ascii');
  record[4] = VERSION;
  record.writeUInt16LE(body.length, 5);
  body.copy(record, 7);
  record.writeUInt16LE(crc16Ccitt(record.subarray(0, -2)), record.length - 2);
  return record;
}

function decodeFixedEnvelope(input, magic) {
  const record = Buffer.from(input ?? []);
  if (record.length < 9 || record.toString('ascii', 0, 4) !== magic || record[4] !== VERSION
      || record.readUInt16LE(5) + 9 !== record.length
      || record.readUInt16LE(record.length - 2) !== crc16Ccitt(record.subarray(0, -2))) {
    throw new Error(`${magic} record envelope is invalid`);
  }
  return record.subarray(7, -2);
}

function readAscii(bytes, offset, length, label) {
  const value = bytes.toString('ascii', offset, offset + length);
  if (value.length !== length || [...value].some((character) => character < ' ' || character > '~')) {
    throw new Error(`SCCO record has invalid ${label}`);
  }
  return value;
}

function artifactKeyOf(artifact) {
  if (typeof artifact?.artifactKey === 'string') return artifact.artifactKey;
  const match = typeof artifact?.artifactId === 'string' && /^sc:ti86:([A-Z2-7]{10})$/.exec(artifact.artifactId);
  return match?.[1] ?? null;
}
