import { createHash } from 'node:crypto';
import {
  TI86_SCHOOLCALC_RUNTIME_MODULE_BITS,
  TI86_SCHOOLCALC_RUNTIME_MODULE_FULL_MASK,
  crc16Ccitt,
} from '../../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';
import { TI86_SCHOOLCALC_LIMITS } from '../../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcLimits.mjs';
import {
  TI86_ASM_EXEC_RAM,
  verifyTi86Program,
} from './ti86-program.mjs';

export const TI86_RUNTIME_MAGIC = 'SCX1';
export const TI86_RUNTIME_ABI_VERSION = 1;
export const TI86_RUNTIME_HEADER_BYTES = 16;
export const TI86_RUNTIME_EXECUTOR_HEADER_BYTES = 21;
// Absolute SCX1 inspection ceiling. Individual registry entries retain their
// tighter per-runtime budgets; only the tutor currently uses the 9 KiB window.
export const TI86_RUNTIME_MAX_CODE_BYTES = TI86_SCHOOLCALC_LIMITS.shellMaxBytes;

export const TI86_RUNTIME_MODULES = Object.freeze({
  standardLearning: Object.freeze({
    id: 'standard-learning',
    code: 1,
    maskBit: TI86_SCHOOLCALC_RUNTIME_MODULE_BITS.standardLearning,
    programName: 'SCLEARN',
    // Capabilities stay empty until the corresponding interactions, queue
    // mutation, and recovery tests pass. Planned behavior is documentation,
    // never a capability claim sent to the backend.
    capabilities: Object.freeze([]),
    maxCodeBytes: TI86_SCHOOLCALC_LIMITS.standardRuntimeMaxBytes,
  }),
  resultQr: Object.freeze({
    id: 'result-qr',
    code: 2,
    maskBit: TI86_SCHOOLCALC_RUNTIME_MODULE_BITS.resultQr,
    programName: 'SCQR',
    capabilities: Object.freeze([]),
    maxCodeBytes: TI86_SCHOOLCALC_LIMITS.qrRuntimeMaxBytes,
  }),
  catalogBrowser: Object.freeze({
    id: 'catalog-browser',
    code: 3,
    maskBit: TI86_SCHOOLCALC_RUNTIME_MODULE_BITS.catalogBrowser,
    programName: 'SCCAT',
    capabilities: Object.freeze([]),
    maxCodeBytes: TI86_SCHOOLCALC_LIMITS.catalogRuntimeMaxBytes,
  }),
  deliveryRequest: Object.freeze({
    id: 'delivery-request',
    code: 4,
    maskBit: TI86_SCHOOLCALC_RUNTIME_MODULE_BITS.deliveryRequest,
    programName: 'SCREQ',
    capabilities: Object.freeze([]),
    maxCodeBytes: TI86_SCHOOLCALC_LIMITS.deliveryRuntimeMaxBytes,
  }),
  resultQueue: Object.freeze({
    id: 'result-queue',
    code: 5,
    maskBit: TI86_SCHOOLCALC_RUNTIME_MODULE_BITS.resultQueue,
    programName: 'SCQUEUE',
    capabilities: Object.freeze([]),
    maxCodeBytes: TI86_SCHOOLCALC_LIMITS.resultQueueRuntimeMaxBytes,
  }),
  foregroundSync: Object.freeze({
    id: 'foreground-sync',
    code: 6,
    maskBit: TI86_SCHOOLCALC_RUNTIME_MODULE_BITS.foregroundSync,
    programName: 'SCSYNC',
    // Cable ownership stays unadvertised until emulator, protected-interface,
    // disconnect, and recovered-fleet execution gates pass.
    capabilities: Object.freeze([]),
    maxCodeBytes: TI86_SCHOOLCALC_LIMITS.syncRuntimeMaxBytes,
  }),
  nativeHandoff: Object.freeze({
    id: 'native-handoff',
    code: 7,
    maskBit: TI86_SCHOOLCALC_RUNTIME_MODULE_BITS.nativeHandoff,
    programName: 'SCNATIVE',
    // The first Z80 slice validates plans and refuses before mutation. Native
    // capability promotion still requires settings snapshot/apply/restore and
    // owned-ROM execution proof.
    capabilities: Object.freeze([]),
    maxCodeBytes: TI86_SCHOOLCALC_LIMITS.nativeRuntimeMaxBytes,
  }),
  learnerProfile: Object.freeze({
    id: 'learner-profile',
    code: 8,
    maskBit: TI86_SCHOOLCALC_RUNTIME_MODULE_BITS.learnerProfile,
    programName: 'SCPROF',
    // Profile selection remains unadvertised until exact-binary execution and
    // recovery tests pass; the backend roster contract is independently live.
    capabilities: Object.freeze([]),
    maxCodeBytes: TI86_SCHOOLCALC_LIMITS.profileRuntimeMaxBytes,
  }),
  realtimeTutor: Object.freeze({
    id: 'realtime-tutor',
    code: 9,
    maskBit: TI86_SCHOOLCALC_RUNTIME_MODULE_BITS.realtimeTutor,
    programName: 'SCTUTOR',
    // The runtime remains unadvertised as a portable capability until its
    // exact-binary and recovered-fleet execution gates pass.
    capabilities: Object.freeze([]),
    maxCodeBytes: TI86_SCHOOLCALC_LIMITS.tutorRuntimeMaxBytes,
  }),
});

/**
 * Patch and validate the fixed SCX1 header emitted by a reviewed Z80 source.
 * The header is metadata inside an ordinary TI-86 assembly program; lesson
 * artifacts are never accepted by this function and cannot select a name.
 */
export function finalizeTi86RuntimeCode(input, definition) {
  const code = Buffer.from(input ?? []);
  assertDefinition(definition);
  const maxCodeBytes = definition.maxCodeBytes ?? TI86_RUNTIME_MAX_CODE_BYTES;
  if (code.length < TI86_RUNTIME_HEADER_BYTES || code.length > maxCodeBytes) {
    throw new Error(`SCX1 module code must be ${TI86_RUNTIME_HEADER_BYTES}..${maxCodeBytes} bytes`);
  }
  const layout = runtimeHeaderLayout(code);
  if (code[layout.jumpOffset] !== 0xC3
      || code.readUInt16LE(layout.jumpOffset + 1) !== TI86_ASM_EXEC_RAM + layout.entryOffset
      || code.toString('ascii', layout.magicOffset, layout.magicOffset + 4) !== TI86_RUNTIME_MAGIC
      || code[layout.abiOffset] !== TI86_RUNTIME_ABI_VERSION
      || code[layout.moduleOffset] !== definition.code
      || code[layout.flagsOffset] !== 0
      || code.readUInt16LE(layout.reservedOffset) !== 0) {
    throw new Error('SCX1 source header does not match the reviewed runtime definition');
  }
  const finalized = Buffer.from(code);
  finalized.writeUInt16LE(finalized.length, layout.lengthOffset);
  finalized.writeUInt16LE(crc16Ccitt(finalized.subarray(layout.headerBytes)), layout.crcOffset);
  inspectTi86RuntimeCode(finalized, definition);
  return finalized;
}

export function inspectTi86RuntimeCode(input, expectedDefinition = null) {
  const code = Buffer.from(input ?? []);
  if (code.length < TI86_RUNTIME_HEADER_BYTES || code.length > TI86_RUNTIME_MAX_CODE_BYTES) {
    throw new Error('SCX1 module length is outside its executable window');
  }
  const layout = runtimeHeaderLayout(code);
  if (code[layout.jumpOffset] !== 0xC3
      || code.readUInt16LE(layout.jumpOffset + 1) !== TI86_ASM_EXEC_RAM + layout.entryOffset) {
    throw new Error('SCX1 module entry jump is invalid');
  }
  if (code.toString('ascii', layout.magicOffset, layout.magicOffset + 4) !== TI86_RUNTIME_MAGIC) {
    throw new Error('SCX1 module magic is invalid');
  }
  if (code[layout.abiOffset] !== TI86_RUNTIME_ABI_VERSION) {
    throw new Error(`SCX1 module ABI ${code[layout.abiOffset]} is unsupported`);
  }
  if (code[layout.flagsOffset] !== 0 || code.readUInt16LE(layout.reservedOffset) !== 0) {
    throw new Error('SCX1 module contains unsupported flags or reserved bytes');
  }
  if (code.readUInt16LE(layout.lengthOffset) !== code.length) {
    throw new Error('SCX1 module length does not match its header');
  }
  const expectedCrc = code.readUInt16LE(layout.crcOffset);
  const actualCrc = crc16Ccitt(code.subarray(layout.headerBytes));
  if (expectedCrc !== actualCrc) throw new Error('SCX1 module checksum failed');

  const definition = Object.values(TI86_RUNTIME_MODULES)
    .find((candidate) => candidate.code === code[layout.moduleOffset]);
  if (!definition) throw new Error(`SCX1 module code ${code[layout.moduleOffset]} is not registered`);
  if (code.length > (definition.maxCodeBytes ?? TI86_RUNTIME_MAX_CODE_BYTES)) {
    throw new Error(`SCX1 module '${definition.id}' exceeds its reviewed code budget`);
  }
  if (expectedDefinition && definition !== expectedDefinition) {
    throw new Error('SCX1 module does not match its expected registry entry');
  }
  return Object.freeze({
    abiVersion: code[layout.abiOffset],
    id: definition.id,
    moduleCode: code[layout.moduleOffset],
    programName: definition.programName,
    capabilities: definition.capabilities,
    codeByteLength: code.length,
    payloadCrc16: expectedCrc,
  });
}

function runtimeHeaderLayout(code) {
  const executorPrefix = code[0] === 0x00;
  const headerBytes = executorPrefix ? TI86_RUNTIME_EXECUTOR_HEADER_BYTES : TI86_RUNTIME_HEADER_BYTES;
  const jumpOffset = executorPrefix ? 1 : 0;
  return Object.freeze({
    headerBytes,
    entryOffset: executorPrefix ? 22 : TI86_RUNTIME_HEADER_BYTES,
    jumpOffset,
    magicOffset: executorPrefix ? 8 : 3,
    abiOffset: executorPrefix ? 12 : 7,
    moduleOffset: executorPrefix ? 13 : 8,
    flagsOffset: executorPrefix ? 14 : 9,
    lengthOffset: executorPrefix ? 15 : 10,
    crcOffset: executorPrefix ? 17 : 12,
    reservedOffset: executorPrefix ? 19 : 14,
  });
}

export function inspectTi86RuntimeProgram(file, expectedDefinition = null) {
  const program = verifyTi86Program(Buffer.from(file));
  const module = inspectTi86RuntimeCode(program.code, expectedDefinition);
  if (program.name !== module.programName) {
    throw new Error(`SCX1 module '${module.id}' must use TI program name ${module.programName}`);
  }
  return Object.freeze({ ...module, fileByteLength: file.length, sha256: sha256(file) });
}

/** Host oracle for the calculator's fail-closed installed-SCX1 discovery. */
export function inspectTi86RuntimeInstallation(programFiles = {}) {
  const files = programFiles instanceof Map
    ? programFiles
    : new Map(Object.entries(programFiles ?? {}));
  let runtimeModuleMask = 0;
  const modules = [];
  for (const definition of Object.values(TI86_RUNTIME_MODULES)) {
    const file = files.get(definition.programName);
    if (file == null) {
      modules.push(Object.freeze({ id: definition.id, programName: definition.programName, valid: false }));
      continue;
    }
    try {
      inspectTi86RuntimeProgram(Buffer.from(file), definition);
      runtimeModuleMask |= definition.maskBit;
      modules.push(Object.freeze({ id: definition.id, programName: definition.programName, valid: true }));
    } catch {
      modules.push(Object.freeze({ id: definition.id, programName: definition.programName, valid: false }));
    }
  }
  return Object.freeze({
    runtimeModuleMask,
    complete: runtimeModuleMask === TI86_SCHOOLCALC_RUNTIME_MODULE_FULL_MASK,
    modules: Object.freeze(modules),
  });
}

export function createTi86ClientReleaseManifest({ version, shellFile, moduleFiles }) {
  if (!/^0\.[0-9]+\.[0-9]+$/.test(version ?? '')) {
    throw new Error('TI-86 client release version must be a greenfield 0.x.y version');
  }
  const shell = verifyTi86Program(Buffer.from(shellFile), { expectedName: 'SCHLCALC' });
  if (!Array.isArray(moduleFiles)) throw new Error('TI-86 client release modules must be an array');
  const modules = moduleFiles.map((file) => inspectTi86RuntimeProgram(Buffer.from(file)));
  const expectedDefinitions = Object.values(TI86_RUNTIME_MODULES);
  if (modules.length !== expectedDefinitions.length
      || expectedDefinitions.some((definition) => !modules.some((module) => module.id === definition.id))) {
    throw new Error('TI-86 client release must contain every registered runtime exactly once');
  }
  if (new Set(modules.map((module) => module.id)).size !== modules.length
      || new Set(modules.map((module) => module.programName)).size !== modules.length) {
    throw new Error('TI-86 client release repeats a runtime identity or program name');
  }
  const estimatedCalculatorStorageBytes = shell.code.length
    + modules.reduce((total, module) => total + module.codeByteLength, 0)
    + ((1 + modules.length) * TI86_SCHOOLCALC_LIMITS.variableOverheadBytes);
  if (estimatedCalculatorStorageBytes > TI86_SCHOOLCALC_LIMITS.standardClientMaxBytes) {
    throw new Error('TI-86 standard client exceeds its aggregate installed-storage ceiling');
  }
  const targetDeltaBytes = estimatedCalculatorStorageBytes
    - TI86_SCHOOLCALC_LIMITS.standardClientTargetBytes;
  return Object.freeze({
    schema: 'school.calc.ti86-client-release/v1',
    version,
    shell: Object.freeze({
      programName: shell.name,
      codeByteLength: shell.code.length,
      fileByteLength: shellFile.length,
      sha256: sha256(shellFile),
    }),
    modules: Object.freeze(modules),
    resourceUse: Object.freeze({
      estimateBasis: 'executable-bytes-plus-conservative-variable-overhead',
      estimatedCalculatorStorageBytes,
      standardClientTargetBytes: TI86_SCHOOLCALC_LIMITS.standardClientTargetBytes,
      standardClientMaxBytes: TI86_SCHOOLCALC_LIMITS.standardClientMaxBytes,
      withinTarget: targetDeltaBytes <= 0,
      targetDeltaBytes,
      maxHeadroomBytes:
        TI86_SCHOOLCALC_LIMITS.standardClientMaxBytes - estimatedCalculatorStorageBytes,
    }),
  });
}

function assertDefinition(definition) {
  if (!Object.values(TI86_RUNTIME_MODULES).includes(definition)) {
    throw new Error('SCX1 runtime definition is not in the closed build registry');
  }
  if (!Number.isInteger(definition.maskBit)
      || definition.maskBit <= 0
      || (definition.maskBit & (definition.maskBit - 1)) !== 0) {
    throw new Error('SCX1 runtime definition has an invalid discovery bit');
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
