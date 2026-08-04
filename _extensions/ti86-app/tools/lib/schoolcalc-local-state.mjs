import { crc16Ccitt } from '../../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';

export const SCHOOLCALC_LOCAL_STATE_MAGIC = 'SCL1';
export const SCHOOLCALC_LOCAL_STATE_BYTES = 124;
export const SCHOOLCALC_LOCAL_STATE_BODY_BYTES = 115;
export const SCHOOLCALC_LOCAL_STATE_SLOTS = Object.freeze(['DSLOCAL0', 'DSLOCAL1']);
export const SCHOOLCALC_LOCAL_DRAFT_BYTES = 48;

export const SCHOOLCALC_LOCAL_FLAGS = Object.freeze({
  sessionActive: 1 << 0,
  draftPresent: 1 << 1,
  nativePending: 1 << 2,
  nativeRestoreNeeded: 1 << 3,
  assessmentStarted: 1 << 4,
  catalogSlot1: 1 << 5,
  installStateSlot1: 1 << 6,
  syncSnapshotPresent: 1 << 7,
  deliveryPending: 1 << 8,
  resultPending: 1 << 9,
  // A zero learner key is the valid synthetic Guest identity, so it cannot
  // double as the first-boot sentinel.  This durable acknowledgement makes
  // Guest just as remembered as a configured learner.
  learnerSelected: 1 << 10,
});

export const SCHOOLCALC_LOCAL_VIEW = Object.freeze({
  home: 0,
  catalog: 1,
  course: 2,
  unit: 3,
  lesson: 4,
  module: 5,
  result: 6,
  sync: 7,
  native: 8,
  delivery: 9,
  subject: 10,
  tutor: 11,
});

export const SCHOOLCALC_DRAFT_KIND = Object.freeze({
  none: 0,
  choice: 1,
  number: 2,
  text: 3,
  ordering: 4,
  matching: 5,
  progress: 6,
  score: 7,
});

export const SCHOOLCALC_NATIVE_CAPABILITY = Object.freeze({
  none: 0,
  calculator: 1,
  graph: 2,
  table: 3,
  solver: 4,
  matrix: 5,
  equationEditor: 6,
  nativeProgram: 7,
});

export const SCHOOLCALC_NATIVE_PHASE = Object.freeze({
  none: 0,
  snapshotCommitted: 1,
  configured: 2,
  restorePending: 3,
});

export const SCHOOLCALC_DELIVERY_ACTION = Object.freeze({
  none: 0,
  install: 1,
  remove: 2,
  update: 3,
});

const BODY = Object.freeze({
  generation: 0,
  flags: 4,
  view: 6,
  artifactKey: 7,
  catalogIndex: 17,
  subjectIndex: 19,
  courseIndex: 21,
  unitIndex: 23,
  lessonIndex: 25,
  moduleIndex: 27,
  itemIndex: 29,
  focus: 31,
  scroll: 33,
  cardFace: 35,
  cardScroll: 36,
  draftKind: 38,
  draftLength: 39,
  draft: 40,
  nextSequence: 88,
  nextRequestId: 91,
  deliveryAction: 94,
  nativeCapability: 95,
  nativePhase: 96,
  nativeSnapshotGeneration: 97,
  catalogGenerationKey: 101,
  selectedLearnerKey: 111,
  sessionLearnerKey: 113,
});
const HEADER_BYTES = 7;
const NONE_INDEX = 0xFFFF;
const KEY = /^[A-Z2-7]{10}$/;

export const SCHOOLCALC_LOCAL_STATE_OFFSETS = Object.freeze(Object.fromEntries(
  Object.entries(BODY).map(([name, offset]) => [name, HEADER_BYTES + offset]),
));

export function encodeSchoolCalcLocalState(input = {}) {
  const state = normalizeState(input);
  const bytes = Buffer.alloc(SCHOOLCALC_LOCAL_STATE_BYTES);
  bytes.write(SCHOOLCALC_LOCAL_STATE_MAGIC, 0, 4, 'ascii');
  bytes[4] = 1;
  bytes.writeUInt16LE(SCHOOLCALC_LOCAL_STATE_BODY_BYTES, 5);
  const body = bytes.subarray(HEADER_BYTES, -2);
  body.writeUInt32LE(state.generation, BODY.generation);
  body.writeUInt16LE(state.flags, BODY.flags);
  body[BODY.view] = SCHOOLCALC_LOCAL_VIEW[state.view];
  writeKey(body, BODY.artifactKey, state.activeArtifactKey);
  for (const [name, offset] of Object.entries({
    catalogIndex: BODY.catalogIndex,
    subjectIndex: BODY.subjectIndex,
    courseIndex: BODY.courseIndex,
    unitIndex: BODY.unitIndex,
    lessonIndex: BODY.lessonIndex,
    moduleIndex: BODY.moduleIndex,
    itemIndex: BODY.itemIndex,
  })) body.writeUInt16LE(state.address[name] ?? NONE_INDEX, offset);
  body.writeUInt16LE(state.focus, BODY.focus);
  body.writeUInt16LE(state.scroll, BODY.scroll);
  body[BODY.cardFace] = state.cardFace;
  body.writeUInt16LE(state.cardScroll, BODY.cardScroll);
  body[BODY.draftKind] = SCHOOLCALC_DRAFT_KIND[state.draftKind];
  body[BODY.draftLength] = state.draft.length;
  state.draft.copy(body, BODY.draft);
  writeU24(body, BODY.nextSequence, state.nextSequence);
  writeU24(body, BODY.nextRequestId, state.nextRequestId);
  body[BODY.deliveryAction] = SCHOOLCALC_DELIVERY_ACTION[state.deliveryAction];
  body[BODY.nativeCapability] = SCHOOLCALC_NATIVE_CAPABILITY[state.native.capability];
  body[BODY.nativePhase] = SCHOOLCALC_NATIVE_PHASE[state.native.phase];
  body.writeUInt32LE(state.native.snapshotGeneration, BODY.nativeSnapshotGeneration);
  writeKey(body, BODY.catalogGenerationKey, state.catalogGenerationKey);
  body.writeUInt16LE(state.selectedLearnerKey, BODY.selectedLearnerKey);
  body.writeUInt16LE(state.sessionLearnerKey, BODY.sessionLearnerKey);
  bytes.writeUInt16LE(crc16Ccitt(bytes.subarray(0, -2)), bytes.length - 2);
  return bytes;
}

export function decodeSchoolCalcLocalState(input) {
  const bytes = asBuffer(input);
  if (bytes.length !== SCHOOLCALC_LOCAL_STATE_BYTES
      || bytes.toString('ascii', 0, 4) !== SCHOOLCALC_LOCAL_STATE_MAGIC
      || bytes[4] !== 1
      || bytes.readUInt16LE(5) !== SCHOOLCALC_LOCAL_STATE_BODY_BYTES
      || bytes.readUInt16LE(bytes.length - 2) !== crc16Ccitt(bytes.subarray(0, -2))) {
    throw new Error('SCL1 local state envelope is invalid');
  }
  const body = bytes.subarray(HEADER_BYTES, -2);
  const flags = body.readUInt16LE(BODY.flags);
  const draftLength = body[BODY.draftLength];
  if (draftLength > SCHOOLCALC_LOCAL_DRAFT_BYTES) throw new Error('SCL1 draft exceeds its bound');
  const decoded = {
    generation: body.readUInt32LE(BODY.generation),
    flags,
    view: enumName(SCHOOLCALC_LOCAL_VIEW, body[BODY.view], 'view'),
    activeArtifactKey: readKey(body, BODY.artifactKey),
    catalogGenerationKey: readKey(body, BODY.catalogGenerationKey),
    address: Object.fromEntries(Object.entries({
      catalogIndex: BODY.catalogIndex,
      subjectIndex: BODY.subjectIndex,
      courseIndex: BODY.courseIndex,
      unitIndex: BODY.unitIndex,
      lessonIndex: BODY.lessonIndex,
      moduleIndex: BODY.moduleIndex,
      itemIndex: BODY.itemIndex,
    }).map(([name, offset]) => [name, readIndex(body, offset)])),
    focus: body.readUInt16LE(BODY.focus),
    scroll: body.readUInt16LE(BODY.scroll),
    cardFace: body[BODY.cardFace],
    cardScroll: body.readUInt16LE(BODY.cardScroll),
    draftKind: enumName(SCHOOLCALC_DRAFT_KIND, body[BODY.draftKind], 'draft kind'),
    draft: Buffer.from(body.subarray(BODY.draft, BODY.draft + draftLength)),
    nextSequence: readU24(body, BODY.nextSequence),
    nextRequestId: readU24(body, BODY.nextRequestId),
    selectedLearnerKey: body.readUInt16LE(BODY.selectedLearnerKey),
    sessionLearnerKey: body.readUInt16LE(BODY.sessionLearnerKey),
    deliveryAction: enumName(SCHOOLCALC_DELIVERY_ACTION, body[BODY.deliveryAction], 'delivery action'),
    native: {
      capability: enumName(SCHOOLCALC_NATIVE_CAPABILITY, body[BODY.nativeCapability], 'native capability'),
      phase: enumName(SCHOOLCALC_NATIVE_PHASE, body[BODY.nativePhase], 'native phase'),
      snapshotGeneration: body.readUInt32LE(BODY.nativeSnapshotGeneration),
    },
  };
  assertStateConsistency(decoded);
  return decoded;
}

/** Select the newest valid slot. Invalid/torn inactive slots are repairable. */
export function selectSchoolCalcLocalState(slots = {}) {
  const candidates = SCHOOLCALC_LOCAL_STATE_SLOTS.map((name, index) => inspectSlot(slots[name], index));
  const valid = candidates.filter((entry) => entry.valid);
  if (valid.length === 0) {
    if (candidates.every((entry) => entry.bytes == null)) {
      return Object.freeze({ state: defaultState(), activeSlot: null, repairSlots: [] });
    }
    throw new Error('both SchoolCalc local-state slots are invalid');
  }
  valid.sort((a, b) => b.state.generation - a.state.generation);
  if (valid.length === 2 && valid[0].state.generation === valid[1].state.generation) {
    // Alternating writes can never legitimately create one generation twice.
    // Treat even byte-identical equality as ambiguous rather than guessing.
    throw new Error('SchoolCalc local-state slots conflict at one generation');
  }
  const selected = valid[0];
  return Object.freeze({
    state: selected.state,
    activeSlot: SCHOOLCALC_LOCAL_STATE_SLOTS[selected.index],
    repairSlots: candidates.filter((entry) => !entry.valid && entry.bytes != null)
      .map((entry) => SCHOOLCALC_LOCAL_STATE_SLOTS[entry.index]),
  });
}

export function prepareSchoolCalcLocalStateSave(selection, patch = {}) {
  const current = selection?.state ?? defaultState();
  if (current.generation >= 0xFFFF_FFFF) throw new Error('SCL1 generation is exhausted');
  const activeIndex = selection?.activeSlot == null
    ? 1
    : SCHOOLCALC_LOCAL_STATE_SLOTS.indexOf(selection.activeSlot);
  if (activeIndex < 0) throw new Error('active SchoolCalc local-state slot is invalid');
  const targetSlot = SCHOOLCALC_LOCAL_STATE_SLOTS[activeIndex ^ 1];
  const state = normalizeState({
    ...current,
    ...patch,
    generation: current.generation + 1,
    address: { ...current.address, ...(patch.address ?? {}) },
    native: { ...current.native, ...(patch.native ?? {}) },
  });
  return Object.freeze({ targetSlot, state, bytes: encodeSchoolCalcLocalState(state) });
}

export function defaultSchoolCalcLocalState() { return defaultState(); }

function normalizeState(input) {
  const state = {
    ...defaultState(),
    ...input,
    address: { ...defaultState().address, ...(input.address ?? {}) },
    native: { ...defaultState().native, ...(input.native ?? {}) },
    draft: input.draft == null ? Buffer.alloc(0) : asBuffer(input.draft),
  };
  uint(state.generation, 0xFFFF_FFFF, 'generation');
  uint(state.flags, 0xFFFF, 'flags');
  if (!(state.view in SCHOOLCALC_LOCAL_VIEW)) throw new Error('SCL1 view is invalid');
  if (state.activeArtifactKey != null && !KEY.test(state.activeArtifactKey)) throw new Error('SCL1 artifact key is invalid');
  if (state.catalogGenerationKey != null && !KEY.test(state.catalogGenerationKey)) throw new Error('SCL1 Catalog generation key is invalid');
  for (const [name, value] of Object.entries(state.address)) {
    if (value != null) uint(value, NONE_INDEX - 1, name);
  }
  uint(state.focus, 0xFFFF, 'focus');
  uint(state.scroll, 0xFFFF, 'scroll');
  uint(state.cardFace, 1, 'cardFace');
  uint(state.cardScroll, 0xFFFF, 'cardScroll');
  if (!(state.draftKind in SCHOOLCALC_DRAFT_KIND)) throw new Error('SCL1 draft kind is invalid');
  if (state.draft.length > SCHOOLCALC_LOCAL_DRAFT_BYTES) throw new Error('SCL1 draft exceeds 48 bytes');
  uint(state.nextSequence, 0xFF_FFFF, 'nextSequence');
  uint(state.nextRequestId, 0xFF_FFFF, 'nextRequestId');
  uint(state.selectedLearnerKey, 0xffff, 'selectedLearnerKey');
  uint(state.sessionLearnerKey, 0xffff, 'sessionLearnerKey');
  if (!(state.deliveryAction in SCHOOLCALC_DELIVERY_ACTION)) throw new Error('SCL1 delivery action is invalid');
  if (!(state.native.capability in SCHOOLCALC_NATIVE_CAPABILITY)) throw new Error('SCL1 native capability is invalid');
  if (!(state.native.phase in SCHOOLCALC_NATIVE_PHASE)) throw new Error('SCL1 native phase is invalid');
  uint(state.native.snapshotGeneration, 0xFFFF_FFFF, 'native snapshot generation');
  assertStateConsistency(state);
  return state;
}

function assertStateConsistency(state) {
  const knownFlags = Object.values(SCHOOLCALC_LOCAL_FLAGS)
    .reduce((mask, flag) => mask | flag, 0);
  if ((state.flags & ~knownFlags) !== 0) throw new Error('SCL1 contains unknown flag bits');
  const draftFlag = Boolean(state.flags & SCHOOLCALC_LOCAL_FLAGS.draftPresent);
  if (draftFlag !== (state.draftKind !== 'none' && state.draft.length > 0)) {
    throw new Error('SCL1 draft flag, kind, and bytes disagree');
  }
  const nativeFlag = Boolean(state.flags & SCHOOLCALC_LOCAL_FLAGS.nativePending);
  if (nativeFlag !== (state.native.capability !== 'none' && state.native.phase !== 'none')) {
    throw new Error('SCL1 native flag and continuation disagree');
  }
  if ((state.flags & SCHOOLCALC_LOCAL_FLAGS.nativeRestoreNeeded)
      && state.native.phase !== 'restorePending') {
    throw new Error('SCL1 restore flag requires restorePending phase');
  }
  const snapshotPresent = Boolean(state.flags & SCHOOLCALC_LOCAL_FLAGS.syncSnapshotPresent);
  if (snapshotPresent !== (state.catalogGenerationKey !== null)) {
    throw new Error('SCL1 sync snapshot flag and Catalog generation key disagree');
  }
  if (!snapshotPresent && (state.flags
      & (SCHOOLCALC_LOCAL_FLAGS.catalogSlot1 | SCHOOLCALC_LOCAL_FLAGS.installStateSlot1))) {
    throw new Error('SCL1 sync slot selectors require a committed snapshot');
  }
  const deliveryPending = Boolean(state.flags & SCHOOLCALC_LOCAL_FLAGS.deliveryPending);
  if (deliveryPending !== (state.deliveryAction !== 'none' && state.view === 'delivery')) {
    throw new Error('SCL1 delivery flag, action, and view disagree');
  }
  const resultPending = Boolean(state.flags & SCHOOLCALC_LOCAL_FLAGS.resultPending);
  const sessionActive = Boolean(state.flags & SCHOOLCALC_LOCAL_FLAGS.sessionActive);
  if (!sessionActive && state.sessionLearnerKey !== 0) {
    throw new Error('SCL1 inactive session cannot retain a learner binding');
  }
  if (resultPending && state.sessionLearnerKey === 0) {
    throw new Error('SCL1 cannot queue persistent Guest work');
  }
  if (resultPending && state.draftKind !== 'choice' && state.draftKind !== 'progress') {
    throw new Error('SCL1 result-pending flag and draft kind disagree');
  }
  if (!resultPending && state.draftKind === 'progress') {
    throw new Error('SCL1 progress draft requires a result-pending flag');
  }
  if (resultPending && deliveryPending) {
    throw new Error('SCL1 cannot queue a result and delivery request simultaneously');
  }
  if (state.draftKind === 'progress') {
    if (state.draft.length !== 5) throw new Error('SCL1 progress continuation must be five bytes');
    const status = state.draft[0];
    const position = state.draft.readUInt16LE(1);
    const total = state.draft.readUInt16LE(3);
    if (status < 1 || status > 4 || position > total) {
      throw new Error('SCL1 progress continuation is invalid');
    }
  }
  if (state.draftKind === 'score') {
    if (state.view !== 'result' || state.draft.length !== 3 || resultPending) {
      throw new Error('SCL1 score summary requires a completed Result view');
    }
    const [correct, total, percent] = state.draft;
    if (total === 0 || correct > total
        || percent !== Math.round((correct / total) * 100)) {
      throw new Error('SCL1 score summary is invalid');
    }
  }
}

function defaultState() {
  return {
    generation: 0,
    flags: 0,
    view: 'home',
    activeArtifactKey: null,
    catalogGenerationKey: null,
    address: {
      catalogIndex: null, subjectIndex: null, courseIndex: null, unitIndex: null,
      lessonIndex: null, moduleIndex: null, itemIndex: null,
    },
    focus: 0,
    scroll: 0,
    cardFace: 0,
    cardScroll: 0,
    draftKind: 'none',
    draft: Buffer.alloc(0),
    nextSequence: 0,
    nextRequestId: 1,
    selectedLearnerKey: 0,
    sessionLearnerKey: 0,
    deliveryAction: 'none',
    native: { capability: 'none', phase: 'none', snapshotGeneration: 0 },
  };
}

function inspectSlot(value, index) {
  if (value == null) return { index, valid: false, bytes: null, state: null };
  const bytes = asBuffer(value);
  try { return { index, valid: true, bytes, state: decodeSchoolCalcLocalState(bytes) }; }
  catch { return { index, valid: false, bytes, state: null }; }
}

function writeKey(bytes, offset, value) {
  if (value != null) bytes.write(value, offset, 10, 'ascii');
}

function readKey(bytes, offset) {
  const value = bytes.toString('ascii', offset, offset + 10);
  if (/^\0{10}$/.test(value)) return null;
  if (!KEY.test(value)) throw new Error('SCL1 contains an invalid compact key');
  return value;
}

function readIndex(bytes, offset) {
  const value = bytes.readUInt16LE(offset);
  return value === NONE_INDEX ? null : value;
}

function writeU24(bytes, offset, value) {
  bytes[offset] = value & 0xFF;
  bytes[offset + 1] = (value >>> 8) & 0xFF;
  bytes[offset + 2] = (value >>> 16) & 0xFF;
}

function readU24(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function enumName(values, code, label) {
  const name = Object.entries(values).find(([, value]) => value === code)?.[0];
  if (!name) throw new Error(`SCL1 ${label} code is invalid`);
  return name;
}

function uint(value, max, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw new Error(`SCL1 ${label} is invalid`);
}

function asBuffer(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new Error('SCL1 value must be bytes');
}
