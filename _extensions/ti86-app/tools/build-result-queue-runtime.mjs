#!/usr/bin/env node
/** Build the reviewed SCQUEUE result/progress queue runtime. */
import {
  mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTi86AsmProgram } from './lib/ti86-program.mjs';
import {
  TI86_RUNTIME_MODULES, finalizeTi86RuntimeCode, inspectTi86RuntimeProgram,
} from './lib/ti86-runtime-module.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(HERE, '..');
const SOURCE_DIRECTORY = path.join(EXTENSION, 'src');
const SOURCE = path.join(SOURCE_DIRECTORY, 'runtime-result-queue.asm');
const OUTPUT = path.join(EXTENSION, 'dist', 'SCQUEUE.86p');
const definition = TI86_RUNTIME_MODULES.resultQueue;

const assembler = spawnSync('z80asm', ['--version'], { encoding: 'utf8' });
if (assembler.error?.code === 'ENOENT') throw new Error('z80asm is required; install it with `brew install z80asm`');
if (assembler.status !== 0) throw new Error(`z80asm is unavailable: ${assembler.stderr}`);

const buildDirectory = mkdtempSync(path.join(tmpdir(), 'schoolcalc-result-queue-'));
try {
  const rawBinary = path.join(buildDirectory, 'scqueue.bin');
  const result = spawnSync('z80asm', ['-I', SOURCE_DIRECTORY, '-o', rawBinary, SOURCE], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`z80asm failed:\n${result.stdout}${result.stderr}`);
  const code = finalizeTi86RuntimeCode(readFileSync(rawBinary), definition);
  const file = createTi86AsmProgram({
    name: definition.programName, code, comment: 'SchoolCalc result queue runtime 0.1',
  });
  const inspected = inspectTi86RuntimeProgram(file, definition);
  mkdirSync(path.dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, file);
  process.stdout.write(`[ti86] built ${OUTPUT} (${file.length} bytes; code ${code.length} bytes; SCX1 ABI ${inspected.abiVersion})\n`);
} finally {
  rmSync(buildDirectory, { recursive: true, force: true });
}
