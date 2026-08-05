#!/usr/bin/env node
/** Build the physical-LCD SchoolCalc design-system probe. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import {
  createTi86AsmProgram,
  TI86_ASM_EXEC_RAM,
  TI86_VIDEO_RAM,
} from './lib/ti86-program.mjs';
import { Z80Emitter } from './lib/z80-emitter.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(HERE, '..');
const SOURCE = path.join(EXTENSION, 'gui', 'screens.yml');
const OUTPUT = path.join(EXTENSION, 'dist', 'SCGUI.86p');
const SCREEN_IDS = ['home', 'catalog', 'lesson', 'notes', 'study-card', 'quiz', 'result', 'sync'];
const FRAME_BYTES = 1024;

const spec = yaml.load(readFileSync(SOURCE, 'utf8'));
if (spec?.schema !== 'schoolcalc.gui/v1' || spec.screen_width !== 128 || spec.screen_height !== 64) {
  throw new Error('SCGUI requires the canonical 128x64 SchoolCalc GUI source');
}
const byId = new Map(spec.screens.map((screen) => [screen.id, screen]));
const frames = SCREEN_IDS.map((id) => packFrame(byId.get(id), spec));

const z = new Z80Emitter({ origin: TI86_ASM_EXEC_RAM });
const CURRENT_SCREEN = 'current_screen';
const RENDER = 'render';
const WAIT = 'wait_key';
const STORE = 'store_screen';

z.call(0x4A7E);                         // _clrLCD
z.emit(0xAF);                           // xor a
z.emit(0x32); z.wordLabel(CURRENT_SCREEN); // ld (current_screen),a
z.jump(RENDER);

z.label(RENDER);
z.emit(0x3A); z.wordLabel(CURRENT_SCREEN); // ld a,(current_screen)
z.emit(0x87, 0x5F, 0x16, 0x00);         // add a,a; ld e,a; ld d,0
z.emit(0x21); z.wordLabel('frame_table'); // ld hl,frame_table
z.emit(0x19, 0x5E, 0x23, 0x56, 0xEB);   // add hl,de; ld e,(hl); inc hl; ld d,(hl); ex de,hl
z.emit(0x11); z.word(TI86_VIDEO_RAM);    // ld de,VideoRam
z.emit(0x01); z.word(FRAME_BYTES);       // ld bc,1024
z.emit(0xED, 0xB0);                     // ldir

z.label(WAIT);
z.call(0x4068);                         // probe key scanner -> A
for (const [key, target] of [
  [0x07, 'exit'], [0x01, 'next'], [0x04, 'next'], [0x02, 'previous'], [0x03, 'previous'],
  [0xC2, 'screen_0'], [0xC3, 'screen_1'], [0xC4, 'screen_2'], [0xC5, 'screen_5'], [0xC6, 'screen_7'],
]) {
  z.emit(0xFE, key);                    // cp key
  z.jumpZero(target);
}
z.jump(WAIT);

z.label('next');
z.emit(0x3A); z.wordLabel(CURRENT_SCREEN); // ld a,(current_screen)
z.emit(0x3C, 0xFE, SCREEN_IDS.length);  // inc a; cp count
z.jumpNotZero(STORE);
z.emit(0xAF);                           // wrap to zero
z.jump(STORE);

z.label('previous');
z.emit(0x3A); z.wordLabel(CURRENT_SCREEN); // ld a,(current_screen)
z.emit(0xB7);                           // or a
z.jumpNotZero('previous_decrement');
z.emit(0x3E, SCREEN_IDS.length);        // ld a,count
z.label('previous_decrement');
z.emit(0x3D);                           // dec a
z.jump(STORE);

for (const index of [0, 1, 2, 5, 7]) {
  z.label(`screen_${index}`);
  if (index === 0) z.emit(0xAF);        // xor a
  else z.emit(0x3E, index);             // ld a,index
  z.jump(STORE);
}

z.label(STORE);
z.emit(0x32); z.wordLabel(CURRENT_SCREEN); // ld (current_screen),a
z.jump(RENDER);

z.label('exit');
z.call(0x4A7E);                         // leave a clean LCD for the OS
z.emit(0xC9);                           // ret

z.label(CURRENT_SCREEN);
z.emit(0);
z.label('frame_table');
SCREEN_IDS.forEach((_, index) => z.wordLabel(`frame_${index}`));
frames.forEach((frame, index) => {
  z.label(`frame_${index}`);
  z.emit(...frame);
});

const code = z.finish();
if (code.length !== z.length) throw new Error('Z80 emitter length changed during resolution');
if (TI86_ASM_EXEC_RAM + code.length > TI86_VIDEO_RAM) {
  throw new Error(`SCGUI would overlap Video RAM by ${TI86_ASM_EXEC_RAM + code.length - TI86_VIDEO_RAM} bytes`);
}
const file = createTi86AsmProgram({
  name: 'SCGUI', code, comment: 'SchoolCalc GUI hardware probe',
});
mkdirSync(path.dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, file);
console.log(`[ti86] built ${OUTPUT} (${file.length} bytes; ${SCREEN_IDS.length} full-screen frames)`);
console.log(`[ti86] keys: arrows browse, F1 home, F2 Catalog, F3 lesson, F4 quiz, F5 sync, EXIT quits`);

function packFrame(screen, value) {
  if (!screen || !Array.isArray(screen.pixels) || screen.pixels.length !== 64) {
    throw new Error(`missing or invalid GUI screen '${screen?.id ?? 'unknown'}'`);
  }
  const bytes = Buffer.alloc(FRAME_BYTES, 0);
  screen.pixels.forEach((row, y) => {
    const pixels = [...row];
    if (pixels.length !== 128) throw new Error(`${screen.id}: row ${y} is not 128 pixels`);
    pixels.forEach((pixel, x) => {
      if (pixel === value.filled) bytes[y * 16 + Math.floor(x / 8)] |= 0x80 >> (x & 7);
      else if (pixel !== value.blank) throw new Error(`${screen.id}: invalid pixel '${pixel}'`);
    });
  });
  return bytes;
}
