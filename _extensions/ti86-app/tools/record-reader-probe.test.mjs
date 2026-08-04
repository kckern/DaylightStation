import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeTi86Envelope } from '../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';
import {
  TI86_ASM_EXEC_RAM,
  TI86_VIDEO_RAM,
  verifyTi86Program,
} from './lib/ti86-program.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(HERE, '..');

describe('TI-86 paged SchoolCalc record reader probe', () => {
  it('embeds one real compiled artifact and assembles below video RAM', () => {
    execFileSync(process.execPath, [path.join(EXTENSION, 'tools', 'build-record-reader-probe.mjs')], {
      cwd: path.resolve(EXTENSION, '..', '..'),
      stdio: 'pipe',
    });
    const file = readFileSync(path.join(EXTENSION, 'dist', 'SCREAD.86p'));
    const { code } = verifyTi86Program(file, { expectedName: 'SCREAD' });
    expect(TI86_ASM_EXEC_RAM + code.length).toBeLessThanOrEqual(TI86_VIDEO_RAM);
    const fixture = findEnvelope(code, 'SCP1');
    expect(decodeTi86Envelope(fixture, 'SCP1')).toMatchObject({
      schema: 'school.calc.ti86-package/v2',
      lesson: { title: 'Reader probe' },
    });
    expect(code.includes(Buffer.from('Corruption rejected\0', 'ascii'))).toBe(true);
  });
});

function findEnvelope(bytes, magic) {
  const signature = Buffer.from(magic, 'ascii');
  for (let offset = bytes.indexOf(signature); offset >= 0;
    offset = bytes.indexOf(signature, offset + 1)) {
    if (offset + 9 > bytes.length) continue;
    const end = offset + 9 + bytes.readUInt16LE(offset + 5);
    if (end > bytes.length) continue;
    const candidate = bytes.subarray(offset, end);
    try {
      decodeTi86Envelope(candidate, magic);
      return candidate;
    } catch {
      // Keep searching past runtime comparison literals.
    }
  }
  throw new Error(`no valid ${magic} envelope in probe`);
}
