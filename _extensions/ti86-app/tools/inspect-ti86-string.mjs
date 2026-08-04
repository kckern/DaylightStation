#!/usr/bin/env node
/** Extract and validate one SchoolCalc record from a TI-86 String file. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { decodeTi86Envelope } from '../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [filename, expectedMagic = 'SCI1'] = process.argv.slice(2);
  if (!filename || !/^[A-Z0-9]{4}$/.test(expectedMagic)) {
    console.error('usage: node inspect-ti86-string.mjs FILE.86s [MAGIC]');
    process.exit(64);
  }

  const parsed = parseTi86StringFile(readFileSync(filename));
  const record = parsed.variableData.subarray(2);
  const decoded = decodeTi86Envelope(record, expectedMagic);
  console.log(JSON.stringify({
    variableName: parsed.name,
    variableType: parsed.type,
    recordBytes: record.length,
    decoded,
  }, null, 2));
}

export function parseTi86StringFile(file) {
  const signature = Buffer.from('**TI86**\x1A\x0A\x00', 'binary');
  if (!Buffer.isBuffer(file) || file.length < 73 || !file.subarray(0, 11).equals(signature)) {
    throw new Error('invalid or truncated TI-86 file');
  }
  const sectionLength = file.readUInt16LE(53);
  if (file.length !== 55 + sectionLength + 2) throw new Error('TI-86 section length mismatch');
  const entry = file.subarray(55, 55 + sectionLength);
  if (entry.length < 18 || entry.readUInt16LE(0) !== 12) throw new Error('invalid TI-86 variable entry');
  const firstLength = entry.readUInt16LE(2);
  const type = entry[4];
  const nameLength = entry[5];
  const name = entry.subarray(6, 6 + nameLength).toString('ascii');
  const secondLength = entry.readUInt16LE(14);
  if (type !== 0x0C) throw new Error(`expected TI-86 String type 0x0C, got 0x${type.toString(16)}`);
  if (firstLength !== secondLength || entry.length !== 16 + secondLength) {
    throw new Error('TI-86 variable data lengths disagree');
  }
  const variableData = entry.subarray(16);
  if (variableData.length < 2 || variableData.readUInt16LE(0) !== variableData.length - 2) {
    throw new Error('TI-86 String length word is invalid');
  }
  const checksum = [...entry].reduce((sum, byte) => (sum + byte) & 0xFFFF, 0);
  if (file.readUInt16LE(file.length - 2) !== checksum) throw new Error('TI-86 file checksum failed');
  return { name, type, variableData: Buffer.from(variableData) };
}
