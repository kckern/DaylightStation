#!/usr/bin/env node
/**
 * Build QRDEMO.86p without an external Z80 assembler.
 *
 * The executable part is deliberately fixed and only copies the generated
 * 1024-byte LCD frame to $FC00:
 *   call $4A7E; ld hl,frame; ld de,$FC00; ld bc,1024; ldir; ret
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTi86AsmProgram, TI86_ASM_EXEC_RAM } from './lib/ti86-program.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.join(__dirname, '..');
const framePath = path.join(extensionDir, 'src', 'generated', 'qr-frame.inc');
const nameArg = process.argv.indexOf('--name');
const PROGRAM_NAME = nameArg === -1 ? 'QRDEMO' : String(process.argv[nameArg + 1] || '').toUpperCase();
if (!/^[A-Z][A-Z0-9]{0,7}$/.test(PROGRAM_NAME)) throw new Error('--name must be 1–8 uppercase letters/digits, starting with a letter');
const out = path.join(extensionDir, 'dist', `${PROGRAM_NAME}.86p`);
const FRAME_BYTES = 1024;

const source = readFileSync(framePath, 'utf8');
const frame = Buffer.from([...source.matchAll(/\$([0-9A-Fa-f]{2})\b/g)].map((m) => Number.parseInt(m[1], 16)));
if (frame.length !== FRAME_BYTES) {
  throw new Error(`${framePath} has ${frame.length} framebuffer bytes; expected ${FRAME_BYTES}`);
}

// Z80 instructions; frame begins immediately after this 15-byte sequence.
const frameAddress = TI86_ASM_EXEC_RAM + 15;
const code = Buffer.from([
  0xCD, 0x7E, 0x4A,
  0x21, frameAddress & 0xFF, frameAddress >> 8,
  0x11, 0x00, 0xFC,
  0x01, 0x00, 0x04,
  0xED, 0xB0,
  0xC9,
]);
const asmProgram = Buffer.concat([code, frame]);
const file = createTi86AsmProgram({
  name: PROGRAM_NAME, code: asmProgram, comment: 'DaylightStation TI-86 QR demo',
});

mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, file);
console.log(`[ti86] built ${out} (${file.length} bytes, payload ${asmProgram.length} bytes)`);
