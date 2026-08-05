#!/usr/bin/env node
/** Build the maintainable z80asm-based SchoolCalc production shell. */
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  TI86_SCHOOLCALC_CLIENT_CAPABILITIES,
  crc16Ccitt,
  encodeTi86DeviceInfo,
} from '../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';
import { TI86_SCHOOLCALC_LIMITS } from '../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcLimits.mjs';
import {
  createTi86AsmProgram,
  TI86_ASM_EXEC_RAM,
  TI86_VIDEO_RAM,
} from './lib/ti86-program.mjs';
import {
  loadSchoolCalcUiAssets,
  renderSchoolCalcUiAssembly,
} from './lib/schoolcalc-ui-assets.mjs';
import {
  SCHOOLCALC_LOCAL_STATE_OFFSETS,
  encodeSchoolCalcLocalState,
} from './lib/schoolcalc-local-state.mjs';
import { TI86_RUNTIME_MODULES } from './lib/ti86-runtime-module.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(HERE, '..');
const SOURCE_DIRECTORY = path.join(EXTENSION, 'src');
const SOURCE = path.join(SOURCE_DIRECTORY, 'schoolcalc.asm');
const GENERATED = path.join(SOURCE_DIRECTORY, 'generated', 'schoolcalc-shell-data.inc');
const GENERATED_UI = path.join(SOURCE_DIRECTORY, 'generated', 'ui-shell-assets.inc');
const OUTPUT = path.join(EXTENSION, 'dist', 'SCHLCALC.86p');

const assembler = spawnSync('z80asm', ['--version'], { encoding: 'utf8' });
if (assembler.error?.code === 'ENOENT') {
  throw new Error('z80asm is required; install it with `brew install z80asm`');
}
if (assembler.status !== 0) throw new Error(`z80asm is unavailable: ${assembler.stderr}`);

const { record, freeBytesOffset, runtimeModuleMaskOffset } = createDeviceInfoTemplate();
const localStateRecord = encodeSchoolCalcLocalState();
const uiAssets = loadSchoolCalcUiAssets(EXTENSION);
mkdirSync(path.dirname(GENERATED), { recursive: true });
writeFileSync(GENERATED, renderAssemblyData({
  record, freeBytesOffset, runtimeModuleMaskOffset, localStateRecord,
}));
writeFileSync(GENERATED_UI, renderSchoolCalcUiAssembly(uiAssets, {
  fontIds: ['compact-3x5'],
  iconIds: [],
}));

const buildDirectory = mkdtempSync(path.join(tmpdir(), 'schoolcalc-z80-'));
const rawBinary = path.join(buildDirectory, 'schoolcalc.bin');
try {
  const result = spawnSync('z80asm', [
    '-I', SOURCE_DIRECTORY,
    '-o', rawBinary,
    SOURCE,
  ], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`z80asm failed:\n${result.stdout}${result.stderr}`);
  }
  const code = readFileSync(rawBinary);
  if (code.length === 0) throw new Error('z80asm emitted an empty SchoolCalc shell');
  if (code.length > TI86_SCHOOLCALC_LIMITS.shellMaxBytes) {
    throw new Error(`SCHLCALC exceeds its ${TI86_SCHOOLCALC_LIMITS.shellMaxBytes}-byte shell budget by ${code.length - TI86_SCHOOLCALC_LIMITS.shellMaxBytes} bytes`);
  }
  if (TI86_ASM_EXEC_RAM + code.length > TI86_VIDEO_RAM) {
    throw new Error(`SCHLCALC overlaps Video RAM by ${TI86_ASM_EXEC_RAM + code.length - TI86_VIDEO_RAM} bytes`);
  }
  const file = createTi86AsmProgram({
    name: 'SCHLCALC', code, comment: 'DaylightStation SchoolCalc shell 0.1',
  });
  mkdirSync(path.dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, file);
  console.log(`[ti86] built ${OUTPUT} (${file.length} bytes; code ${code.length} bytes)`);
  console.log(`[ti86] DSINFO ${record.length} bytes; live freeBytes patch @ ${freeBytesOffset}`);
  console.log(`[ti86] DSINFO installed-runtime mask patch @ ${runtimeModuleMaskOffset}`);
  console.log(`[ti86] SCL1 ${localStateRecord.length} bytes; alternating DSLOCAL0/DSLOCAL1`);
  console.log('[ti86] linked UI profile: compact 3px font; core renderer');
  console.log('[ti86] installed SCX1 discovery: enabled; runtime capabilities remain fail-closed');
} finally {
  rmSync(buildDirectory, { recursive: true, force: true });
}

function createDeviceInfoTemplate() {
  const freeBytesSentinel = 0x12345678;
  const runtimeMaskSentinel = 0x5A1C3E7B;
  const record = encodeTi86DeviceInfo({
    shellVersion: '0.1.0',
    capabilities: TI86_SCHOOLCALC_CLIENT_CAPABILITIES,
    installedArtifactIds: [],
    freeBytes: freeBytesSentinel,
    maxArtifactBytes: TI86_SCHOOLCALC_LIMITS.lessonMaxBytes,
    runtimeModuleMask: runtimeMaskSentinel,
  });
  const freeBytesOffset = locateInt32(record, freeBytesSentinel, 'freeBytes');
  const runtimeModuleMaskOffset = locateInt32(record, runtimeMaskSentinel, 'runtimeModuleMask');
  record.fill(0, freeBytesOffset, freeBytesOffset + 4);
  record.fill(0, runtimeModuleMaskOffset, runtimeModuleMaskOffset + 4);
  record.writeUInt16LE(crc16Ccitt(record.subarray(0, -2)), record.length - 2);
  return { record, freeBytesOffset, runtimeModuleMaskOffset };
}

function renderAssemblyData({ record, freeBytesOffset, runtimeModuleMaskOffset, localStateRecord }) {
  const lines = [
    '; Generated by tools/build-schoolcalc-shell.mjs. Do not hand edit.',
    'dsinfo_record:',
    ...assemblyBytes(record),
    `DSINFO_RECORD_LENGTH: equ ${record.length}`,
    `DSINFO_FREE_OFFSET: equ ${freeBytesOffset}`,
    `DSINFO_CRC_OFFSET: equ ${record.length - 2}`,
    `DSINFO_FREE_ADDR: equ dsinfo_record + ${freeBytesOffset}`,
    `DSINFO_FREE_ADDR_2: equ dsinfo_record + ${freeBytesOffset + 2}`,
    `DSINFO_FREE_ADDR_3: equ dsinfo_record + ${freeBytesOffset + 3}`,
    `DSINFO_RUNTIME_MASK_ADDR: equ dsinfo_record + ${runtimeModuleMaskOffset}`,
    `DSINFO_RUNTIME_MASK_ADDR_1: equ dsinfo_record + ${runtimeModuleMaskOffset + 1}`,
    `DSINFO_RUNTIME_MASK_ADDR_2: equ dsinfo_record + ${runtimeModuleMaskOffset + 2}`,
    `DSINFO_RUNTIME_MASK_ADDR_3: equ dsinfo_record + ${runtimeModuleMaskOffset + 3}`,
    `DSINFO_CRC_ADDR: equ dsinfo_record + ${record.length - 2}`,
    `DSINFO_CRC_ADDR_1: equ dsinfo_record + ${record.length - 1}`,
    '',
    'local_state_record:',
    ...assemblyBytes(localStateRecord),
    `SCL_RECORD_LENGTH: equ ${localStateRecord.length}`,
    `SCL_GENERATION_ADDR: equ local_state_record + ${SCHOOLCALC_LOCAL_STATE_OFFSETS.generation}`,
    `SCL_FLAGS_ADDR: equ local_state_record + ${SCHOOLCALC_LOCAL_STATE_OFFSETS.flags}`,
    `SCL_FLAGS_HIGH_ADDR: equ local_state_record + ${SCHOOLCALC_LOCAL_STATE_OFFSETS.flags + 1}`,
    `SCL_VIEW_ADDR: equ local_state_record + ${SCHOOLCALC_LOCAL_STATE_OFFSETS.view}`,
    `SCL_ARTIFACT_KEY_ADDR: equ local_state_record + ${SCHOOLCALC_LOCAL_STATE_OFFSETS.artifactKey}`,
    `SCL_CATALOG_INDEX_ADDR: equ local_state_record + ${SCHOOLCALC_LOCAL_STATE_OFFSETS.catalogIndex}`,
    `SCL_SUBJECT_INDEX_ADDR: equ local_state_record + ${SCHOOLCALC_LOCAL_STATE_OFFSETS.subjectIndex}`,
    `SCL_COURSE_INDEX_ADDR: equ local_state_record + ${SCHOOLCALC_LOCAL_STATE_OFFSETS.courseIndex}`,
    `SCL_UNIT_INDEX_ADDR: equ local_state_record + ${SCHOOLCALC_LOCAL_STATE_OFFSETS.unitIndex}`,
    `SCL_LESSON_INDEX_ADDR: equ local_state_record + ${SCHOOLCALC_LOCAL_STATE_OFFSETS.lessonIndex}`,
    `SCL_MODULE_INDEX_ADDR: equ local_state_record + ${SCHOOLCALC_LOCAL_STATE_OFFSETS.moduleIndex}`,
    `SCL_ITEM_INDEX_ADDR: equ local_state_record + ${SCHOOLCALC_LOCAL_STATE_OFFSETS.itemIndex}`,
    `SCL_FOCUS_ADDR: equ local_state_record + ${SCHOOLCALC_LOCAL_STATE_OFFSETS.focus}`,
    `SCL_SCROLL_ADDR: equ local_state_record + ${SCHOOLCALC_LOCAL_STATE_OFFSETS.scroll}`,
    `SCL_CARD_FACE_ADDR: equ local_state_record + ${SCHOOLCALC_LOCAL_STATE_OFFSETS.cardFace}`,
    `SCL_CARD_SCROLL_ADDR: equ local_state_record + ${SCHOOLCALC_LOCAL_STATE_OFFSETS.cardScroll}`,
    `SCL_DRAFT_KIND_ADDR: equ local_state_record + ${SCHOOLCALC_LOCAL_STATE_OFFSETS.draftKind}`,
    `SCL_DRAFT_LENGTH_ADDR: equ local_state_record + ${SCHOOLCALC_LOCAL_STATE_OFFSETS.draftLength}`,
    `SCL_NEXT_REQUEST_ID_ADDR: equ local_state_record + ${SCHOOLCALC_LOCAL_STATE_OFFSETS.nextRequestId}`,
    `SCL_DELIVERY_ACTION_ADDR: equ local_state_record + ${SCHOOLCALC_LOCAL_STATE_OFFSETS.deliveryAction}`,
    `SCL_CATALOG_KEY_ADDR: equ local_state_record + ${SCHOOLCALC_LOCAL_STATE_OFFSETS.catalogGenerationKey}`,
    `SCL_SELECTED_LEARNER_ADDR: equ local_state_record + ${SCHOOLCALC_LOCAL_STATE_OFFSETS.selectedLearnerKey}`,
    `SCL_SESSION_LEARNER_ADDR: equ local_state_record + ${SCHOOLCALC_LOCAL_STATE_OFFSETS.sessionLearnerKey}`,
    `SCL_CRC_OFFSET: equ ${localStateRecord.length - 2}`,
    `SCL_CRC_ADDR: equ local_state_record + ${localStateRecord.length - 2}`,
    `SCL_CRC_ADDR_1: equ local_state_record + ${localStateRecord.length - 1}`,
    '',
    ...renderRuntimeModuleTable(),
  ];
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function renderRuntimeModuleTable() {
  const definitions = Object.entries(TI86_RUNTIME_MODULES);
  const lines = [
    `RUNTIME_MODULE_COUNT: equ ${definitions.length}`,
    'RUNTIME_MODULE_ENTRY_BYTES: equ 15',
    'runtime_module_table:',
  ];
  for (const [, definition] of definitions) {
    const bit = definition.maskBit;
    const descriptor = Buffer.alloc(10, 0);
    descriptor[0] = 0x12;
    descriptor[1] = definition.programName.length;
    descriptor.write(definition.programName, 2, 'ascii');
    lines.push(...assemblyBytes(Buffer.concat([
      descriptor,
      Buffer.from([definition.code]),
      Buffer.from([definition.maxCodeBytes & 0xFF, definition.maxCodeBytes >>> 8]),
      Buffer.from([bit & 0xFF, bit >>> 8]),
    ])));
  }
  return lines;
}

function locateInt32(record, value, label) {
  const needle = Buffer.from([
    0x03,
    value & 0xFF,
    (value >>> 8) & 0xFF,
    (value >>> 16) & 0xFF,
    (value >>> 24) & 0xFF,
  ]);
  const taggedOffset = record.indexOf(needle);
  if (taggedOffset < 0 || record.indexOf(needle, taggedOffset + 1) >= 0) {
    throw new Error(`could not uniquely locate ${label} int32 in DSINFO template`);
  }
  return taggedOffset + 1;
}

function assemblyBytes(bytes) {
  const lines = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    lines.push(`        defb ${[...bytes.subarray(offset, offset + 16)]
      .map((byte) => `0x${byte.toString(16).padStart(2, '0')}`)
      .join(',')}`);
  }
  return lines;
}
