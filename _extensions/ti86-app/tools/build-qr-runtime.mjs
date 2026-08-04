#!/usr/bin/env node
/** Build the reviewed SCQR outbound-result QR runtime. */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTi86AsmProgram } from './lib/ti86-program.mjs';
import {
  TI86_RUNTIME_MODULES,
  finalizeTi86RuntimeCode,
  inspectTi86RuntimeProgram,
} from './lib/ti86-runtime-module.mjs';
import { renderTi86ResultQrV5Assembly } from './lib/ti86-result-qr-v5.mjs';
import {
  loadSchoolCalcUiAssets,
  renderSchoolCalcUiAssembly,
} from './lib/schoolcalc-ui-assets.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(HERE, '..');
const SOURCE_DIRECTORY = path.join(EXTENSION, 'src');
const SOURCE = path.join(SOURCE_DIRECTORY, 'runtime-qr.asm');
const GENERATED_QR = path.join(SOURCE_DIRECTORY, 'generated', 'qr-v5-assets.inc');
const GENERATED_UI = path.join(SOURCE_DIRECTORY, 'generated', 'ui-qr-runtime-assets.inc');
const OUTPUT = path.join(EXTENSION, 'dist', 'SCQR.86p');
const definition = TI86_RUNTIME_MODULES.resultQr;

const assembler = spawnSync('z80asm', ['--version'], { encoding: 'utf8' });
if (assembler.error?.code === 'ENOENT') {
  throw new Error('z80asm is required; install it with `brew install z80asm`');
}
if (assembler.status !== 0) throw new Error(`z80asm is unavailable: ${assembler.stderr}`);

mkdirSync(path.dirname(GENERATED_QR), { recursive: true });
writeFileSync(GENERATED_QR, renderTi86ResultQrV5Assembly());
const uiAssets = loadSchoolCalcUiAssets(EXTENSION);
writeFileSync(GENERATED_UI, renderSchoolCalcUiAssembly(uiAssets, {
  fontIds: ['compact-3x5'], iconIds: [],
}));

const buildDirectory = mkdtempSync(path.join(tmpdir(), 'schoolcalc-qr-runtime-'));
try {
  const rawBinary = path.join(buildDirectory, 'scqr.bin');
  const result = spawnSync('z80asm', [
    '-I', SOURCE_DIRECTORY,
    '-o', rawBinary,
    SOURCE,
  ], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`z80asm failed:\n${result.stdout}${result.stderr}`);
  const code = finalizeTi86RuntimeCode(readFileSync(rawBinary), definition);
  const file = createTi86AsmProgram({
    name: definition.programName,
    code,
    comment: 'SchoolCalc reviewed result QR runtime 0.1',
  });
  const inspected = inspectTi86RuntimeProgram(file, definition);
  mkdirSync(path.dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, file);
  process.stdout.write(`[ti86] built ${OUTPUT} (${file.length} bytes; code ${code.length} bytes; SCX1 ABI ${inspected.abiVersion})\n`);
  process.stdout.write('[ti86] advertised QR capabilities: none (dynamic QR awaits emulator/fleet recovery gates)\n');
} finally {
  rmSync(buildDirectory, { recursive: true, force: true });
}
