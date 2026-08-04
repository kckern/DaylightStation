/**
 * Offset-oriented reader for TI-86 SchoolCalc binary documents.
 *
 * Unlike the backend decoder, this API does not materialize the value tree.
 * It exposes string-table, map, and array offsets in the same form used by a
 * bounded Z80 cursor/cache implementation.
 */
const TAG = Object.freeze({
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
const TYPE_BY_TAG = Object.freeze(Object.fromEntries(
  Object.entries(TAG).map(([type, tag]) => [tag, type]),
));
const MAX_DEPTH = 32;
const MAX_NODES = 0xFFFF;

export class SchoolCalcRecordView {
  #record;
  #body;
  #strings;
  #rootOffset;

  constructor(input, { expectedMagic, maxRecordBytes = 0x10008 } = {}) {
    const record = asBuffer(input);
    if (!/^[A-Z0-9]{4}$/.test(expectedMagic || '')) {
      throw new Error('SchoolCalc record view requires a four-character expectedMagic');
    }
    if (record.length < 9 || record.length > maxRecordBytes) {
      throw new Error(`${expectedMagic} record is truncated or exceeds its byte bound`);
    }
    if (record.toString('ascii', 0, 4) !== expectedMagic) {
      throw new Error(`${expectedMagic} record has the wrong magic`);
    }
    if (record[4] !== 1) throw new Error(`${expectedMagic} record uses unsupported version ${record[4]}`);
    const bodyLength = record.readUInt16LE(5);
    if (record.length !== 9 + bodyLength) throw new Error(`${expectedMagic} record length does not match its header`);
    if (record.readUInt16LE(record.length - 2) !== crc16Ccitt(record.subarray(0, -2))) {
      throw new Error(`${expectedMagic} record checksum failed`);
    }

    this.#record = Buffer.from(record);
    this.#body = this.#record.subarray(7, -2);
    const cursor = new Cursor(this.#body, expectedMagic);
    const stringCount = cursor.u16('string count');
    this.#strings = [];
    const seen = new Set();
    for (let index = 0; index < stringCount; index += 1) {
      const byteLength = cursor.u16(`string ${index} length`);
      const offset = cursor.offset;
      const bytes = cursor.take(byteLength, `string ${index}`);
      let value;
      try { value = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { throw new Error(`${expectedMagic} binary document has invalid UTF-8 in string ${index}`); }
      if (cursor.u8(`string ${index} terminator`) !== 0) {
        throw new Error(`${expectedMagic} binary document string ${index} lacks its NUL terminator`);
      }
      if (seen.has(value)) throw new Error(`${expectedMagic} binary document repeats a string-table value`);
      seen.add(value);
      this.#strings.push(Object.freeze({ index, offset, byteLength, value }));
    }
    this.#rootOffset = cursor.offset;
    const validation = this.#skip(this.#rootOffset, 0, { nodes: 0, validateMaps: true });
    if (validation.offset !== this.#body.length) {
      throw new Error(`${expectedMagic} binary document has trailing bytes`);
    }
  }

  get magic() { return this.#record.toString('ascii', 0, 4); }
  get byteLength() { return this.#record.length; }
  get bodyByteLength() { return this.#body.length; }
  get rootOffset() { return this.#rootOffset; }
  get stringCount() { return this.#strings.length; }

  string(index) {
    const entry = this.#strings[index];
    if (!entry) throw new Error(`binary document has invalid string reference ${index}`);
    return entry;
  }

  node(offset = this.#rootOffset) {
    this.#need(offset, 1, 'value tag');
    const tag = this.#body[offset];
    const type = TYPE_BY_TAG[tag];
    if (type === undefined) throw new Error(`binary document has unknown value tag ${tag}`);
    if (tag === TAG.null || tag === TAG.false || tag === TAG.true) {
      return Object.freeze({ offset, endOffset: offset + 1, type, value: tag === TAG.true ? true : tag === TAG.false ? false : null });
    }
    if (tag === TAG.int32) {
      this.#need(offset + 1, 4, 'int32');
      return Object.freeze({ offset, endOffset: offset + 5, type, value: this.#body.readInt32LE(offset + 1) });
    }
    if (tag === TAG.float64) {
      this.#need(offset + 1, 8, 'float64');
      const value = this.#body.readDoubleLE(offset + 1);
      if (!Number.isFinite(value)) throw new Error('binary document contains a non-finite number');
      return Object.freeze({ offset, endOffset: offset + 9, type, value });
    }
    if (tag === TAG.string) {
      this.#need(offset + 1, 2, 'string reference');
      const string = this.string(this.#body.readUInt16LE(offset + 1));
      return Object.freeze({ offset, endOffset: offset + 3, type, value: string.value, stringIndex: string.index });
    }
    if (tag === TAG.bytes) {
      this.#need(offset + 1, 2, 'byte string length');
      const byteLength = this.#body.readUInt16LE(offset + 1);
      this.#need(offset + 3, byteLength, 'byte string');
      return Object.freeze({ offset, endOffset: offset + 3 + byteLength, type, byteLength });
    }
    this.#need(offset + 1, 2, `${type} length`);
    return Object.freeze({
      offset,
      endOffset: this.#skip(offset, 0, { nodes: 0, validateMaps: false }).offset,
      type,
      count: this.#body.readUInt16LE(offset + 1),
      entriesOffset: offset + 3,
    });
  }

  bytes(nodeOrOffset) {
    const node = this.#asNode(nodeOrOffset, 'bytes');
    return Buffer.from(this.#body.subarray(node.offset + 3, node.endOffset));
  }

  arrayItem(nodeOrOffset, index) {
    const node = this.#asNode(nodeOrOffset, 'array');
    if (!Number.isInteger(index) || index < 0 || index >= node.count) return null;
    let offset = node.entriesOffset;
    for (let current = 0; current < index; current += 1) {
      offset = this.#skip(offset, 1, { nodes: 0, validateMaps: false }).offset;
    }
    return this.node(offset);
  }

  mapEntry(nodeOrOffset, key) {
    const node = this.#asNode(nodeOrOffset, 'map');
    let offset = node.entriesOffset;
    for (let index = 0; index < node.count; index += 1) {
      this.#need(offset, 2, 'mapping key');
      const entryKey = this.string(this.#body.readUInt16LE(offset)).value;
      const valueOffset = offset + 2;
      if (entryKey === key) return this.node(valueOffset);
      offset = this.#skip(valueOffset, 1, { nodes: 0, validateMaps: false }).offset;
    }
    return null;
  }

  path(...segments) {
    let node = this.node(this.#rootOffset);
    for (const segment of segments) {
      node = typeof segment === 'number'
        ? this.arrayItem(node, segment)
        : this.mapEntry(node, segment);
      if (!node) return null;
    }
    return node;
  }

  #asNode(nodeOrOffset, type) {
    const node = typeof nodeOrOffset === 'number' ? this.node(nodeOrOffset) : nodeOrOffset;
    if (!node || node.type !== type) throw new Error(`expected binary document ${type}`);
    return node;
  }

  #skip(offset, depth, state) {
    if (depth > MAX_DEPTH) throw new Error('binary document exceeds maximum nesting depth');
    state.nodes += 1;
    if (state.nodes > MAX_NODES) throw new Error('binary document has too many values');
    this.#need(offset, 1, 'value tag');
    const tag = this.#body[offset++];
    if (tag <= TAG.true) return { offset };
    if (tag === TAG.int32) return { offset: this.#advance(offset, 4, 'int32') };
    if (tag === TAG.float64) {
      const end = this.#advance(offset, 8, 'float64');
      if (!Number.isFinite(this.#body.readDoubleLE(offset))) throw new Error('binary document contains a non-finite number');
      return { offset: end };
    }
    if (tag === TAG.string) {
      this.#need(offset, 2, 'string reference');
      this.string(this.#body.readUInt16LE(offset));
      return { offset: offset + 2 };
    }
    if (tag === TAG.bytes) {
      this.#need(offset, 2, 'byte string length');
      const length = this.#body.readUInt16LE(offset);
      return { offset: this.#advance(offset + 2, length, 'byte string') };
    }
    if (tag !== TAG.array && tag !== TAG.map) throw new Error(`binary document has unknown value tag ${tag}`);
    this.#need(offset, 2, `${TYPE_BY_TAG[tag]} length`);
    const count = this.#body.readUInt16LE(offset);
    offset += 2;
    const keys = state.validateMaps && tag === TAG.map ? new Set() : null;
    for (let index = 0; index < count; index += 1) {
      if (tag === TAG.map) {
        this.#need(offset, 2, 'mapping key');
        const keyIndex = this.#body.readUInt16LE(offset);
        const key = this.string(keyIndex).value;
        if (keys?.has(key)) throw new Error(`binary document repeats mapping key '${key}'`);
        keys?.add(key);
        offset += 2;
      }
      offset = this.#skip(offset, depth + 1, state).offset;
    }
    return { offset };
  }

  #advance(offset, length, label) {
    this.#need(offset, length, label);
    return offset + length;
  }

  #need(offset, length, label) {
    if (!Number.isInteger(offset) || offset < 0 || offset + length > this.#body.length) {
      throw new Error(`binary document is truncated at ${label}`);
    }
  }
}

export function openSchoolCalcRecord(input, options) {
  return new SchoolCalcRecordView(input, options);
}

class Cursor {
  #bytes;
  #offset = 0;
  #label;

  constructor(bytes, label) {
    this.#bytes = bytes;
    this.#label = label;
  }

  get offset() { return this.#offset; }

  u8(name) {
    this.#need(1, name);
    return this.#bytes[this.#offset++];
  }

  u16(name) {
    this.#need(2, name);
    const value = this.#bytes.readUInt16LE(this.#offset);
    this.#offset += 2;
    return value;
  }

  take(length, name) {
    this.#need(length, name);
    const value = this.#bytes.subarray(this.#offset, this.#offset + length);
    this.#offset += length;
    return value;
  }

  #need(length, name) {
    if (this.#offset + length > this.#bytes.length) {
      throw new Error(`${this.#label} binary document is truncated at ${name}`);
    }
  }
}

function asBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  throw new Error('SchoolCalc record must be bytes');
}

function crc16Ccitt(bytes) {
  let crc = 0xFFFF;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
  }
  return crc;
}

export const SCHOOLCALC_BINARY_TAG = TAG;
