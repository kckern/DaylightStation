const SIGNATURE = Buffer.from('**TI86**\x1A\x0A\x00', 'binary');
const COMMENT_BYTES = 42;

export const TI86_ASM_EXEC_RAM = 0xD748;
export const TI86_VIDEO_RAM = 0xFC00;

/** Package executable Z80 bytes as one TI-86 assembly program variable. */
export function createTi86AsmProgram({ name, code, comment = 'DaylightStation SchoolCalc' } = {}) {
  const programName = String(name ?? '').toUpperCase();
  if (!/^[A-Z][A-Z0-9]{0,7}$/.test(programName)) {
    throw new Error('TI-86 program name must be 1–8 uppercase letters/digits, starting with a letter');
  }
  if (!Buffer.isBuffer(code) || code.length === 0 || code.length > 0xFFFB) {
    throw new Error('TI-86 assembly code must be a non-empty Buffer of at most 65531 bytes');
  }

  const variableName = Buffer.alloc(8, 0);
  variableName.write(programName, 'ascii');
  // TI-86 program body: executable byte count, Asm( marker 8E28h, then code.
  const variableData = Buffer.concat([
    u16(code.length), Buffer.from([0x8E, 0x28]), code,
  ]);
  const entry = Buffer.concat([
    u16(12), u16(variableData.length), Buffer.from([0x12, programName.length]),
    variableName, u16(variableData.length), variableData,
  ]);
  const commentBytes = Buffer.alloc(COMMENT_BYTES, 0);
  commentBytes.write(String(comment).slice(0, COMMENT_BYTES), 'ascii');
  const header = Buffer.concat([SIGNATURE, commentBytes, u16(entry.length)]);
  const checksum = additiveChecksum(entry);
  const file = Buffer.concat([header, entry, u16(checksum)]);
  verifyTi86Program(file, { expectedName: programName, expectedCode: code });
  return file;
}

/** Package tokenized TI-BASIC source as an editable TI-86 Program variable. */
export function createTi86BasicProgram({ name, tokens, comment = 'DaylightStation SchoolCalc launcher' } = {}) {
  const programName = String(name ?? '').toUpperCase();
  if (!/^[A-Z][A-Z0-9]{0,7}$/.test(programName)) {
    throw new Error('TI-86 program name must be 1–8 uppercase letters/digits, starting with a letter');
  }
  const source = Buffer.from(tokens ?? []);
  if (source.length === 0 || source.length > 0xFFFF) {
    throw new Error('TI-86 BASIC tokens must be a non-empty Buffer of at most 65535 bytes');
  }
  // 8E28 is reserved for a compiled assembly Program. A BASIC launcher is
  // deliberately tokenized as ordinary editable Program source instead.
  if (source.subarray(0, 2).equals(Buffer.from([0x8E, 0x28]))) {
    throw new Error('TI-86 BASIC source must not begin with the compiled-assembly token');
  }
  const variableName = Buffer.alloc(8, 0);
  variableName.write(programName, 'ascii');
  // Program variables use the same data layout as TI-86 Strings: a two-byte
  // token-stream length followed by the editable source itself.
  const variableData = Buffer.concat([u16(source.length), source]);
  const entry = Buffer.concat([
    u16(12), u16(variableData.length), Buffer.from([0x12, programName.length]),
    variableName, u16(variableData.length), variableData,
  ]);
  const commentBytes = Buffer.alloc(COMMENT_BYTES, 0);
  commentBytes.write(String(comment).slice(0, COMMENT_BYTES), 'ascii');
  const file = Buffer.concat([
    SIGNATURE, commentBytes, u16(entry.length), entry, u16(additiveChecksum(entry)),
  ]);
  verifyTi86BasicProgram(file, { expectedName: programName, expectedTokens: source });
  return file;
}

/** Package several already-verified programs as one TI-86 group transfer. */
export function createTi86ProgramGroup({ programFiles, comment = 'DaylightStation SchoolCalc client' } = {}) {
  if (!Array.isArray(programFiles) || programFiles.length === 0) {
    throw new Error('TI-86 program group requires at least one program');
  }
  const programs = programFiles.map((file) => {
    const bytes = Buffer.from(file);
    const program = verifyTi86Program(bytes);
    return { ...program, entry: bytes.subarray(55, bytes.length - 2) };
  });
  if (new Set(programs.map((program) => program.name)).size !== programs.length) {
    throw new Error('TI-86 program group repeats a program name');
  }
  const section = Buffer.concat(programs.map((program) => program.entry));
  if (section.length > 0xFFFF) throw new Error('TI-86 program group data section is too large');
  const commentBytes = Buffer.alloc(COMMENT_BYTES, 0);
  commentBytes.write(String(comment).slice(0, COMMENT_BYTES), 'ascii');
  const file = Buffer.concat([
    SIGNATURE, commentBytes, u16(section.length), section, u16(additiveChecksum(section)),
  ]);
  verifyTi86ProgramGroup(file, { expectedNames: programs.map((program) => program.name) });
  return file;
}

/** Strictly validate a TI-86 group containing only assembly programs. */
export function verifyTi86ProgramGroup(file, { expectedNames = null } = {}) {
  const bytes = Buffer.from(file ?? []);
  const section = readFileSection(bytes);
  const programs = [];
  let offset = 0;
  while (offset < section.length) {
    if (offset + 16 > section.length) throw new Error('truncated TI-86 group entry');
    const dataLength = section.readUInt16LE(offset + 2);
    const entryLength = 16 + dataLength;
    if (offset + entryLength > section.length) throw new Error('truncated TI-86 group variable data');
    programs.push(parseAsmEntry(section.subarray(offset, offset + entryLength)));
    offset += entryLength;
  }
  const names = programs.map((program) => program.name);
  if (new Set(names).size !== names.length) throw new Error('TI-86 program group repeats a program name');
  if (expectedNames !== null
      && (expectedNames.length !== names.length
        || expectedNames.some((name, index) => name !== names[index]))) {
    throw new Error('TI-86 program group names or order do not match');
  }
  return Object.freeze({ programs: Object.freeze(programs), sectionLength: section.length });
}

/** Strictly validate the container shape emitted above. */
export function verifyTi86Program(file, { expectedName = null, expectedCode = null } = {}) {
  if (!Buffer.isBuffer(file)) throw new Error('TI-86 program must be bytes');
  const section = readFileSection(file);
  const { name, code } = parseAsmEntry(section);
  if (expectedName !== null && name !== expectedName) throw new Error('TI-86 program name mismatch');
  if (expectedCode !== null && !code.equals(expectedCode)) throw new Error('TI-86 code bytes mismatch');
  return { name, code: Buffer.from(code), sectionLength: section.length };
}

/** Strictly validate an editable, tokenized TI-BASIC Program file. */
export function verifyTi86BasicProgram(file, { expectedName = null, expectedTokens = null } = {}) {
  if (!Buffer.isBuffer(file)) throw new Error('TI-86 program must be bytes');
  const section = readFileSection(file);
  if (section.length < 18 || section.readUInt16LE(0) !== 12 || section[4] !== 0x12) {
    throw new Error('invalid TI-86 BASIC program entry');
  }
  const nameLength = section[5];
  if (nameLength < 1 || nameLength > 8) throw new Error('invalid TI-86 BASIC program name length');
  const name = section.subarray(6, 6 + nameLength).toString('ascii');
  const firstLength = section.readUInt16LE(2);
  const secondLength = section.readUInt16LE(14);
  if (firstLength !== secondLength || secondLength + 16 !== section.length) {
    throw new Error('TI-86 BASIC program variable lengths disagree');
  }
  const variableData = section.subarray(16);
  const tokenLength = variableData.readUInt16LE(0);
  if (tokenLength + 2 !== variableData.length) throw new Error('invalid TI-86 BASIC token length');
  const tokens = Buffer.from(variableData.subarray(2));
  if (tokens.subarray(0, 2).equals(Buffer.from([0x8E, 0x28]))) {
    throw new Error('compiled assembly is not a TI-86 BASIC program');
  }
  if (expectedName !== null && name !== expectedName) throw new Error('TI-86 BASIC program name mismatch');
  if (expectedTokens !== null && !tokens.equals(expectedTokens)) throw new Error('TI-86 BASIC program tokens mismatch');
  return Object.freeze({ name, tokens, sectionLength: section.length });
}

/**
 * Read one ordinary TI-86 transfer file as the exact calculator variable
 * bytes it carries.  `variableData` includes the OS-owned leading length
 * word; it is deliberately preserved for emulator provisioning, because an
 * Asm( Program's logical length excludes its two-byte Asm marker.
 */
export function readTi86VariableFile(file) {
  if (!Buffer.isBuffer(file)) throw new Error('TI-86 variable file must be bytes');
  const section = readFileSection(file);
  if (section.length < 18 || section.readUInt16LE(0) !== 12) {
    throw new Error('invalid TI-86 variable entry');
  }
  const dataLength = section.readUInt16LE(2);
  const type = section[4];
  const nameLength = section[5];
  if (nameLength < 1 || nameLength > 8 || section.length !== 16 + dataLength) {
    throw new Error('invalid TI-86 variable entry shape');
  }
  const name = section.subarray(6, 6 + nameLength).toString('ascii');
  if (!/^[A-Z][A-Z0-9]{0,7}$/.test(name)) throw new Error('invalid TI-86 variable name');
  const repeatedLength = section.readUInt16LE(14);
  if (repeatedLength !== dataLength || dataLength < 2) {
    throw new Error('TI-86 variable lengths disagree');
  }
  const variableData = Buffer.from(section.subarray(16));
  return Object.freeze({
    name,
    type,
    variableData,
    storageLength: variableData.length - 2,
    sectionLength: section.length,
  });
}

function readFileSection(file) {
  if (file.length < 73 || !file.subarray(0, 11).equals(SIGNATURE)) {
    throw new Error('invalid TI-86 program signature or truncated file');
  }
  const sectionLength = file.readUInt16LE(53);
  if (file.length !== 55 + sectionLength + 2) throw new Error('invalid TI-86 data-section length');
  const section = file.subarray(55, 55 + sectionLength);
  if (file.readUInt16LE(file.length - 2) !== additiveChecksum(section)) {
    throw new Error('invalid TI-86 file checksum');
  }
  return section;
}

function parseAsmEntry(entry) {
  if (entry.length < 20 || entry.readUInt16LE(0) !== 12 || entry[4] !== 0x12) {
    throw new Error('invalid TI-86 program entry');
  }
  const nameLength = entry[5];
  if (nameLength < 1 || nameLength > 8) throw new Error('invalid TI-86 program name length');
  const name = entry.subarray(6, 6 + nameLength).toString('ascii');
  if (!/^[A-Z][A-Z0-9]{0,7}$/.test(name)) throw new Error('invalid TI-86 program name');
  const firstLength = entry.readUInt16LE(2);
  const secondLength = entry.readUInt16LE(14);
  if (firstLength !== secondLength || secondLength + 16 !== entry.length) {
    throw new Error('TI-86 program variable lengths disagree');
  }
  const variableData = entry.subarray(16);
  const codeLength = variableData.readUInt16LE(0);
  if (variableData[2] !== 0x8E || variableData[3] !== 0x28
      || codeLength + 4 !== variableData.length) {
    throw new Error('invalid TI-86 Asm( program body');
  }
  return Object.freeze({ name, code: Buffer.from(variableData.subarray(4)) });
}

function u16(value) { return Buffer.from([value & 0xFF, (value >>> 8) & 0xFF]); }

function additiveChecksum(bytes) {
  return [...bytes].reduce((sum, byte) => (sum + byte) & 0xFFFF, 0);
}
