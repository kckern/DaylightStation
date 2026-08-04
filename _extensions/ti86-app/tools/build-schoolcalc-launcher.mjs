#!/usr/bin/env node
/** Build the editable TI-BASIC one-touch launcher for the SchoolCalc shell. */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTi86BasicProgram } from './lib/ti86-program.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(HERE, '..');
const OUTPUT = path.join(EXTENSION, 'dist', 'ASCHL.86p');

// Asm is the TI-86 token 8E25; the open and close parentheses are ordinary
// 10/11 tokens. Program references use a 33–3A token whose value is 32 +
// name length, so SCHLCALC's eight-character name uses 3A. Like every
// editable TI-BASIC line, the expression must end in the 6F hard-return
// token. Omitting it makes TI-OS show ERROR 07 SYNTAX instead of executing
// the contained Asm( call.
const TOKENS = Buffer.from([0x8E, 0x25, 0x10, 0x3A, ...Buffer.from('SCHLCALC'), 0x11, 0x6F]);
const file = createTi86BasicProgram({
  name: 'ASCHL', tokens: TOKENS,
  comment: 'Run SchoolCalc: Asm(SCHLCALC)',
});
mkdirSync(path.dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, file);
process.stdout.write(`[ti86] built ${OUTPUT} — editable TI-BASIC: Asm(SCHLCALC)\n`);
