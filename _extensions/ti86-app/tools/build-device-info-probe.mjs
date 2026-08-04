#!/usr/bin/env node
/**
 * Build a physical-hardware probe that creates a valid DSINFO String using
 * TI-OS variable routines, then shows the canonical SchoolCalc sync screen.
 *
 * This is intentionally named SCINFO rather than SCHLCALC: its free-memory and
 * installation fields are fixed test data.  The production shell will patch
 * those fields from live calculator state before recomputing the record CRC.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import {
  TI86_SCHOOLCALC_CLIENT_CAPABILITIES,
  encodeTi86DeviceInfo,
} from '../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';
import {
  createTi86AsmProgram,
  TI86_ASM_EXEC_RAM,
  TI86_VIDEO_RAM,
} from './lib/ti86-program.mjs';
import { Z80Emitter } from './lib/z80-emitter.mjs';
import {
  TI86_ROM,
  TI86_RAW_SCAN_CODE,
  emitReplaceTi86String,
  ti86VariableNameDescriptor,
} from './lib/ti86-os-vars.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(HERE, '..');
const GUI_SOURCE = path.join(EXTENSION, 'gui', 'screens.yml');
const OUTPUT = path.join(EXTENSION, 'dist', 'SCINFO.86p');
const FRAME_BYTES = 1024;
const record = encodeTi86DeviceInfo({
  shellVersion: '0.1.0-probe',
  capabilities: TI86_SCHOOLCALC_CLIENT_CAPABILITIES,
  installedArtifactIds: [],
  freeBytes: 32_000,
  maxArtifactBytes: 12 * 1024,
  runtimeModuleMask: 0,
});
const frame = loadFrame('sync');

const z = new Z80Emitter({ origin: TI86_ASM_EXEC_RAM });
emitReplaceTi86String(z, {
  nameLabel: 'dsinfo_name',
  dataLabel: 'dsinfo_record',
  dataLength: record.length,
});
z.call(TI86_ROM.runIndicatorOff);
z.emit(0xFB);                                   // ei
z.emit(0xFD, 0xCB, 0x09, 0xA6);               // res 4,(iy+9): clear stale ON
z.call(TI86_ROM.resetAutomaticPowerDown);
z.call(TI86_ROM.getKey);                       // discard launch key
z.emit(0x21); z.wordLabel('sync_frame');      // ld hl,sync frame
z.emit(0x11); z.word(TI86_VIDEO_RAM);         // ld de,Video RAM
z.emit(0x01); z.word(FRAME_BYTES);            // ld bc,1024
z.emit(0xED, 0xB0);                           // ldir

z.label('wait_key');
z.emit(0xFD, 0xCB, 0x09, 0x66);               // bit 4,(iy+9): ON interrupt
z.jumpNotZero('exit');
z.call(TI86_ROM.getKey);
z.emit(0xFE, TI86_RAW_SCAN_CODE.on);
z.jumpZero('exit');
z.emit(0xFE, TI86_RAW_SCAN_CODE.clear);
z.jumpZero('exit');
z.emit(0xFE, TI86_RAW_SCAN_CODE.exit);
z.jumpZero('exit');
z.emit(0xFE, TI86_RAW_SCAN_CODE.enter);
z.jumpZero('exit');
z.call(TI86_ROM.idle);                        // no full-speed busy loop
z.jump('wait_key');
z.label('exit');
z.call(TI86_ROM.runIndicatorOff);
z.call(TI86_ROM.clearLcd);
z.emit(0xC3); z.word(TI86_ROM.forceCommandNoCharacter);

z.label('dsinfo_name');
z.emit(...ti86VariableNameDescriptor('DSINFO'));
z.label('dsinfo_record');
z.emit(...record);
z.label('sync_frame');
z.emit(...frame);

const code = z.finish();
if (TI86_ASM_EXEC_RAM + code.length > TI86_VIDEO_RAM) {
  throw new Error('SCINFO overlaps TI-86 Video RAM');
}
const file = createTi86AsmProgram({
  name: 'SCINFO', code, comment: 'SchoolCalc DSINFO variable probe',
});
mkdirSync(path.dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, file);
console.log(`[ti86] built ${OUTPUT} (${file.length} bytes; DSINFO ${record.length} bytes)`);
console.log('[ti86] run Asm(SCINFO); ENTER/EXIT leave, CLEAR/ON are emergency exits');

function loadFrame(screenId) {
  const spec = yaml.load(readFileSync(GUI_SOURCE, 'utf8'));
  const screen = spec?.screens?.find((entry) => entry.id === screenId);
  if (spec?.schema !== 'schoolcalc.gui/v1'
      || spec.screen_width !== 128
      || spec.screen_height !== 64
      || !screen
      || !Array.isArray(screen.pixels)
      || screen.pixels.length !== 64) {
    throw new Error(`invalid SchoolCalc GUI frame '${screenId}'`);
  }
  const bytes = Buffer.alloc(FRAME_BYTES, 0);
  screen.pixels.forEach((row, y) => {
    const pixels = [...row];
    if (pixels.length !== 128) throw new Error(`${screenId}: row ${y} is not 128 pixels`);
    pixels.forEach((pixel, x) => {
      if (pixel === spec.filled) bytes[y * 16 + Math.floor(x / 8)] |= 0x80 >> (x & 7);
      else if (pixel !== spec.blank) throw new Error(`${screenId}: invalid pixel '${pixel}'`);
    });
  });
  return bytes;
}
