#!/usr/bin/env node
/**
 * Build a one-shot TI-86 assembly utility that removes an explicit list of
 * obsolete String variables through TI-OS.  It deliberately cannot touch
 * Programs, so it is safe for retiring superseded content packs while the
 * runtime, learner roster, local state, and queue remain installed.
 *
 * Usage:
 *   node tools/build-ti86-string-cleaner.mjs OUTPUT.86p NAME [NAME ...]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTi86AsmProgram, TI86_ASM_EXEC_RAM, TI86_VIDEO_RAM } from './lib/ti86-program.mjs';
import { Z80Emitter } from './lib/z80-emitter.mjs';
import { TI86_ROM, ti86VariableNameDescriptor } from './lib/ti86-os-vars.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [output, ...requestedNames] = process.argv.slice(2);
if (!output || requestedNames.length === 0) {
  throw new Error('usage: build-ti86-string-cleaner.mjs OUTPUT.86p NAME [NAME ...]');
}

const names = [...new Set(requestedNames.map((name) => String(name).toUpperCase()))];
for (const name of names) ti86VariableNameDescriptor(name);

const z = new Z80Emitter({ origin: TI86_ASM_EXEC_RAM });
for (const [index] of names.entries()) {
  z.emit(0x21); z.wordLabel(`name_${index}`); // ld hl, String name descriptor
  z.emit(0xE7);                               // rst 20h: _Mov10ToOP1
  z.emit(0xD7);                               // rst 10h: _FindSym
  z.emit(0xD4); z.word(TI86_ROM.deleteVariable); // call nc,_DelVar if present
}
z.call(TI86_ROM.runIndicatorOff);
z.emit(0xC9);                                 // return to the calling TI-BASIC launcher
for (const [index, name] of names.entries()) {
  z.label(`name_${index}`);
  z.emit(...ti86VariableNameDescriptor(name));
}

const code = z.finish();
if (TI86_ASM_EXEC_RAM + code.length >= TI86_VIDEO_RAM) {
  throw new Error('string cleaner overlaps the TI-86 LCD buffer');
}
const file = createTi86AsmProgram({
  name: 'SCCLEAN',
  code,
  comment: 'SchoolCalc obsolete String cleaner',
});
mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
writeFileSync(output, file);
process.stdout.write(`[ti86] built ${output}: removes ${names.join(', ')}\n`);
