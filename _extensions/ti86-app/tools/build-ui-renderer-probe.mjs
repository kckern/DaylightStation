#!/usr/bin/env node
/** Build the physical SchoolCalc runtime typography/component probe. */
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  createTi86AsmProgram,
  TI86_ASM_EXEC_RAM,
  TI86_VIDEO_RAM,
} from './lib/ti86-program.mjs';
import {
  loadSchoolCalcUiAssets,
  renderSchoolCalcUiAssembly,
} from './lib/schoolcalc-ui-assets.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(HERE, '..');
const SOURCE_DIRECTORY = path.join(EXTENSION, 'src');
const SOURCE = path.join(SOURCE_DIRECTORY, 'ui-renderer-probe.asm');
const GENERATED = path.join(SOURCE_DIRECTORY, 'generated', 'ui-assets.inc');
const OUTPUT = path.join(EXTENSION, 'dist', 'SCUIPRB.86p');

const assets = loadSchoolCalcUiAssets(EXTENSION);
mkdirSync(path.dirname(GENERATED), { recursive: true });
writeFileSync(GENERATED, renderSchoolCalcUiAssembly(assets));

const buildDirectory = mkdtempSync(path.join(tmpdir(), 'schoolcalc-ui-z80-'));
const rawBinary = path.join(buildDirectory, 'ui-renderer-probe.bin');
try {
  const result = spawnSync('z80asm', [
    '-I', SOURCE_DIRECTORY,
    '-o', rawBinary,
    SOURCE,
  ], { encoding: 'utf8' });
  if (result.error?.code === 'ENOENT') throw new Error('z80asm is required; install it with `brew install z80asm`');
  if (result.status !== 0) throw new Error(`z80asm failed:\n${result.stdout}${result.stderr}`);
  const code = readFileSync(rawBinary);
  if (TI86_ASM_EXEC_RAM + code.length > TI86_VIDEO_RAM) {
    throw new Error(`SCUIPRB overlaps Video RAM by ${TI86_ASM_EXEC_RAM + code.length - TI86_VIDEO_RAM} bytes`);
  }
  const file = createTi86AsmProgram({
    name: 'SCUIPRB', code, comment: 'SchoolCalc runtime UI renderer probe',
  });
  mkdirSync(path.dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, file);
  console.log(`[ti86] built ${OUTPUT} (${file.length} bytes; code ${code.length} bytes)`);
  console.log(`[ti86] runtime assets: ${assets.fonts.size} fonts, ${assets.icons.length} icons; arrows/F1-F3 browse`);
} finally {
  rmSync(buildDirectory, { recursive: true, force: true });
}
