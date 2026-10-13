const SIGNATURE = Buffer.from('**TI86**\x1A\x0A\x00', 'binary');
const COMMENT_BYTES = 42;

/** Package exact SchoolCalc record bytes as one TI-86 String transfer file. */
export function createTi86StringFile({ name, record, comment = 'DaylightStation SchoolCalc' } = {}) {
  const variableName = String(name ?? '').toUpperCase();
  if (!/^[A-Z][A-Z0-9]{0,7}$/.test(variableName)) throw new Error('invalid TI-86 String name');
  if (!Buffer.isBuffer(record) || record.length > 0xFFFD) throw new Error('invalid TI-86 String record');
  const nameBytes = Buffer.alloc(8, 0);
  nameBytes.write(variableName, 'ascii');
  const variableData = Buffer.concat([u16(record.length), record]);
  const entry = Buffer.concat([
    u16(12), u16(variableData.length), Buffer.from([0x0C, variableName.length]),
    nameBytes, u16(variableData.length), variableData,
  ]);
  const commentBytes = Buffer.alloc(COMMENT_BYTES, 0);
  commentBytes.write(String(comment).slice(0, COMMENT_BYTES), 'ascii');
  return Buffer.concat([
    SIGNATURE, commentBytes, u16(entry.length), entry, u16(checksum(entry)),
  ]);
}

function u16(value) { return Buffer.from([value & 0xFF, value >>> 8]); }
function checksum(bytes) {
  return [...bytes].reduce((sum, byte) => (sum + byte) & 0xFFFF, 0);
}

