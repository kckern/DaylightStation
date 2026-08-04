#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyTi86Program } from './lib/ti86-program.mjs';
import {
  createTi86MameArguments,
  createTi86MameInputScript,
  inspectTi86Rom,
  normalizeMameTi86Key,
  sha1,
  sha256,
} from './lib/ti86-mame.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(HERE, '..');

try {
  const options = parseArguments(process.argv.slice(2));
  const rom = readFileSync(options.rom);
  const romDescriptor = inspectTi86Rom(rom);
  const programFile = readFileSync(options.program);
  const verifiedProgram = verifyTi86Program(programFile);
  const keys = options.keys.map(normalizeMameTi86Key);
  const mameVersion = readMameVersion(options.mame);
  const programDigest = sha256(programFile);
  const runResults = [];

  writeLine(`[ti86:mame] MAME ${mameVersion}`);
  writeLine(`[ti86:mame] ROM ${romDescriptor.version} sha1=${sha1(rom)}`);
  if (romDescriptor.knownBadDump) {
    writeLine('[ti86:mame] WARNING: MAME marks this ROM revision as BAD_DUMP');
  }
  writeLine(`[ti86:mame] ${verifiedProgram.name} sha256=${programDigest}`);

  for (const key of keys) {
    const run = runOneKey({
      ...options,
      key,
      code: verifiedProgram.code,
      rom,
      romDescriptor,
    });
    runResults.push(run);
    writeLine(`[ti86:mame] ${key}: ${run.passed ? 'PASS' : 'FAIL'}`);
    if (!run.passed) throw new Error(`${key} did not reach TI-OS forced return: ${run.detail}`);
  }

  const report = {
    schema: 'schoolcalc.ti86-mame-input-gate/v1',
    generatedAt: new Date().toISOString(),
    mameVersion,
    rom: {
      version: romDescriptor.version,
      bios: romDescriptor.bios,
      sha1: romDescriptor.sha1,
      knownBadDump: Boolean(romDescriptor.knownBadDump),
    },
    program: {
      name: verifiedProgram.name,
      byteLength: programFile.length,
      codeByteLength: verifiedProgram.code.length,
      sha256: programDigest,
    },
    results: runResults.map(({ key, passed, detail }) => ({ key, passed, detail })),
  };
  mkdirSync(path.dirname(options.report), { recursive: true });
  writeFileSync(options.report, `${JSON.stringify(report, null, 2)}\n`);
  writeLine(`[ti86:mame] wrote ${options.report}`);
} catch (error) {
  process.stderr.write(`[ti86:mame] ${error.message}\n`);
  process.exitCode = 1;
}

function runOneKey({ mame, key, code, rom, romDescriptor, keepTemp }) {
  const runPath = mkdtempSync(path.join(tmpdir(), `schoolcalc-mame-${key.toLowerCase()}-`));
  try {
    const romRoot = path.join(runPath, 'roms');
    const machineRomPath = path.join(romRoot, 'ti86');
    mkdirSync(machineRomPath, { recursive: true });
    for (const directory of ['nvram', 'cfg', 'input', 'state', 'snap']) {
      mkdirSync(path.join(runPath, directory));
    }
    writeFileSync(path.join(machineRomPath, romDescriptor.filename), rom);

    const scriptPath = path.join(runPath, 'input-gate.lua');
    const debugScriptPath = path.join(runPath, 'resume.cmd');
    writeFileSync(scriptPath, createTi86MameInputScript({ code, key }));
    writeFileSync(debugScriptPath, 'go\n');
    const args = createTi86MameArguments({
      bios: romDescriptor.bios,
      romPath: romRoot,
      scriptPath,
      debugScriptPath,
      workPath: runPath,
    });
    const execution = spawnSync(mame, args, {
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 8 * 1024 * 1024,
      // CI/headless macOS has no usable Cocoa display. The scenario harness
      // already runs MAME this way; keep the exact-binary gate equivalent.
      env: { ...process.env, SDL_VIDEODRIVER: 'dummy', SDL_AUDIODRIVER: 'dummy' },
    });
    if (execution.error) throw execution.error;
    const output = `${execution.stdout ?? ''}\n${execution.stderr ?? ''}`;
    const passLine = output.split(/\r?\n/)
      .find((line) => line.includes(`SCHOOLCALC_MAME_PASS key=${key}`));
    if (passLine) {
      return { key, passed: true, detail: 'force-command-no-character' };
    }
    const failure = output.split(/\r?\n/)
      .find((line) => line.includes(`SCHOOLCALC_MAME_FAIL key=${key}`));
    const tail = output.trim().split(/\r?\n/).slice(-12).join(' | ');
    return {
      key,
      passed: false,
      detail: failure ?? `exit=${execution.status} signal=${execution.signal ?? 'none'} output=${tail}`,
    };
  } finally {
    if (keepTemp) writeLine(`[ti86:mame] kept ${runPath}`);
    else rmSync(runPath, { recursive: true, force: true });
  }
}

function readMameVersion(executable) {
  const result = spawnSync(executable, ['-version'], { encoding: 'utf8', timeout: 5_000 });
  if (result.error) throw new Error(`cannot execute MAME '${executable}': ${result.error.message}`);
  if (result.status !== 0) throw new Error(`MAME version check exited ${result.status}`);
  return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().split(/\r?\n/)[0];
}

function parseArguments(args) {
  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--keep-temp') {
      flags.add(token);
      continue;
    }
    if (!token.startsWith('--') || index + 1 >= args.length) usage();
    values.set(token, args[index + 1]);
    index += 1;
  }
  if (!values.get('--rom')) usage();
  const program = path.resolve(values.get('--program') ?? path.join(EXTENSION, 'dist', 'SCINFO.86p'));
  const programStem = path.basename(program, path.extname(program));
  return {
    rom: path.resolve(values.get('--rom')),
    program,
    keys: (values.get('--keys') ?? 'ENTER,EXIT,CLEAR,ON').split(',').filter(Boolean),
    mame: values.get('--mame') ?? 'mame',
    report: path.resolve(values.get('--report')
      ?? path.join(EXTENSION, 'dist', `${programStem}.mame-input-gate.json`)),
    keepTemp: flags.has('--keep-temp'),
  };
}

function usage() {
  process.stderr.write('Usage: node ti86-mame-input-gate.mjs --rom CALCULATOR.rom '
    + '[--program PROGRAM.86p] [--keys ENTER,EXIT,CLEAR,ON] [--mame PATH] '
    + '[--report REPORT.json] [--keep-temp]\n');
  process.exit(2);
}

function writeLine(message) {
  process.stdout.write(`${message}\n`);
}
