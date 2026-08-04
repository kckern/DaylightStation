import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { verifyTi86BasicProgram } from './lib/ti86-program.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const LAUNCHER = path.join(HERE, 'build-schoolcalc-launcher.mjs');
const OUTPUT = path.join(HERE, '..', 'dist', 'ASCHL.86p');

describe('SchoolCalc TI-BASIC launcher', () => {
  it('uses the exact TI-86 Asm(SCHLCALC) token sequence', () => {
    execFileSync(process.execPath, [LAUNCHER], { cwd: ROOT });
    const program = verifyTi86BasicProgram(readFileSync(OUTPUT), { expectedName: 'ASCHL' });
    expect(program.tokens).toEqual(Buffer.from([
      0x8E, 0x25, 0x10, 0x3A, ...Buffer.from('SCHLCALC'), 0x11, 0x6F,
    ]));
  });
});
