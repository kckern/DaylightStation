#!/usr/bin/env node
/** Build the fail-closed SCNATIVE plan-validation runtime. */
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
import {
  loadSchoolCalcUiAssets,
  renderSchoolCalcUiAssembly,
} from './lib/schoolcalc-ui-assets.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(HERE, '..');
const SOURCE_DIRECTORY = path.join(EXTENSION, 'src');
const SOURCE = path.join(SOURCE_DIRECTORY, 'runtime-native.asm');
const GENERATED_UI = path.join(SOURCE_DIRECTORY, 'generated', 'ui-native-runtime-assets.inc');
const OUTPUT = path.join(EXTENSION, 'dist', 'SCNATIVE.86p');
const definition = TI86_RUNTIME_MODULES.nativeHandoff;

const assembler = spawnSync('z80asm', ['--version'], { encoding: 'utf8' });
if (assembler.error?.code === 'ENOENT') {
  throw new Error('z80asm is required; install it with `brew install z80asm`');
}
if (assembler.status !== 0) throw new Error(`z80asm is unavailable: ${assembler.stderr}`);

const uiAssets = loadSchoolCalcUiAssets(EXTENSION);
mkdirSync(path.dirname(GENERATED_UI), { recursive: true });
writeFileSync(GENERATED_UI, renderSchoolCalcUiAssembly(uiAssets, {
  fontIds: ['compact-3x5'],
  iconIds: [],
}));

const buildDirectory = mkdtempSync(path.join(tmpdir(), 'schoolcalc-native-runtime-'));
try {
  const rawBinary = path.join(buildDirectory, 'scnative.bin');
  const result = spawnSync('z80asm', [
    '-I', SOURCE_DIRECTORY,
    '-o', rawBinary,
    SOURCE,
  ], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`z80asm failed:\n${result.stdout}${result.stderr}`);
  const code = finalizeTi86RuntimeCode(readFileSync(rawBinary), definition);
  assertParserOnlyExecutable(code);
  const file = createTi86AsmProgram({
    name: definition.programName,
    code,
    comment: 'SchoolCalc native-plan guard runtime 0.1',
  });
  const inspected = inspectTi86RuntimeProgram(file, definition);
  mkdirSync(path.dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, file);
  process.stdout.write(`[ti86] built ${OUTPUT} (${file.length} bytes; code ${code.length} bytes; SCX1 ABI ${inspected.abiVersion})\n`);
  process.stdout.write('[ti86] advertised native capabilities: none (TI-OS mutation/restore and ROM gates remain)\n');
} finally {
  rmSync(buildDirectory, { recursive: true, force: true });
}

/**
 * This release may read ordinary variables and draw its status screen, but it
 * must not contain any direct call/jump encoding for variable mutation or a
 * native OS transfer. Failing on a coincidental data sequence is acceptable:
 * the invariant is intentionally stronger than a source call-graph review.
 */
function assertParserOnlyExecutable(code) {
  const transferOpcodes = [
    0xC2, 0xCA, 0xD2, 0xDA, 0xE2, 0xEA, 0xF2, 0xFA, 0xC3,
    0xC4, 0xCC, 0xD4, 0xDC, 0xE4, 0xEC, 0xF4, 0xFC, 0xCD,
  ];
  const forbiddenTargets = [
    ['TI-OS String creation', 0x472F],
    ['TI-OS variable deletion', 0x475F],
    ['assembly-program execution', 0x5730],
    ['graph-screen launch', 0x4D6F],
  ];
  for (const [name, address] of forbiddenTargets) {
    for (const opcode of transferOpcodes) {
      const encoded = Buffer.from([opcode, address & 0xFF, address >>> 8]);
      if (code.indexOf(encoded) !== -1) {
        throw new Error(`SCNATIVE parser-only boundary contains ${name} transfer`);
      }
    }
  }
}
