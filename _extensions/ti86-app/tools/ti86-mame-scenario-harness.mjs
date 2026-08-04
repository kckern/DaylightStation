#!/usr/bin/env node
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from 'canvas';
import { parse as parseYaml } from 'yaml';
import { verifyTi86Program } from './lib/ti86-program.mjs';
import { createTi86MameArguments, inspectTi86Rom, sha256 } from './lib/ti86-mame.mjs';
import { decodeTi86Screen } from './lib/ti86-screen-text.mjs';
import {
  createTi86MameGraphLinkScenarioScript,
  normalizeTi86MameScenario,
  parseTi86MameScenarioOutput,
  renderTi86FramebufferAscii,
} from './lib/ti86-mame-scenario.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(HERE, '..');

try {
  const options = parseArguments(process.argv.slice(2));
  const rom = readFileSync(options.rom);
  const romDescriptor = inspectTi86Rom(rom);
  const manifest = JSON.parse(readFileSync(path.join(options.bundle, 'complete-install.json'), 'utf8'));
  validateManifest(manifest, options.bundle);
  const programNames = [...new Set([...(manifest.programs ?? []), manifest.launcher])]
    .map((name) => String(name).trim().toUpperCase())
    .sort();
  const launchProgram = String(options.launchProgram ?? manifest.launcher ?? '').trim().toUpperCase();
  if (!programNames.includes(launchProgram)) throw new Error(`release does not contain launch program ${launchProgram}`);
  const shell = verifyTi86Program(readFileSync(path.join(options.bundle, 'SCHLCALC.86p')), {
    expectedName: 'SCHLCALC',
  });
  const specification = parseYaml(readFileSync(options.scenarios, 'utf8'));
  if (specification?.schema !== 'schoolcalc.ti86-mame-scenarios/v1') {
    throw new Error('invalid MAME scenario specification schema');
  }
  const selected = (specification.scenarios ?? [])
    .map(normalizeTi86MameScenario)
    .filter(({ id }) => options.only.size === 0 || options.only.has(id));
  if (selected.length === 0) throw new Error('no MAME scenarios selected');

  mkdirSync(options.output, { recursive: true });
  const reports = [];
  writeLine(`[ti86:mame] ROM ${romDescriptor.version} release ${manifest.releaseId}`);
  for (const scenario of selected) {
    writeLine(`[ti86:mame] running ${scenario.id}`);
    const result = await runScenario({
      ...options,
      rom,
      romDescriptor,
      manifest,
      programNames,
      launchProgram,
      shellCode: shell.code,
      scenario,
    });
    reports.push(result);
    writeLine(`[ti86:mame] ${scenario.id}: PASS (${result.frames.length} frames)`);
  }
  const report = {
    schema: 'schoolcalc.ti86-mame-scenario-report/v1',
    generatedAt: new Date().toISOString(),
    releaseId: manifest.releaseId,
    rom: { version: romDescriptor.version, sha1: romDescriptor.sha1 },
    scenarios: reports,
  };
  writeFileSync(path.join(options.output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeLine(`[ti86:mame] wrote ${path.join(options.output, 'report.json')}`);
} catch (error) {
  process.stderr.write(`[ti86:mame] ${error.stack ?? error.message}\n`);
  process.exitCode = 1;
}

async function runScenario(options) {
  const runPath = mkdtempSync(path.join(tmpdir(), `schoolcalc-mame-${options.scenario.id}-`));
  const romRoot = path.join(runPath, 'roms');
  const machineRomPath = path.join(romRoot, 'ti86');
  for (const directory of [machineRomPath, 'nvram', 'cfg', 'input', 'state', 'snap']) {
    mkdirSync(path.isAbsolute(directory) ? directory : path.join(runPath, directory), { recursive: true });
  }
  writeFileSync(path.join(machineRomPath, options.romDescriptor.filename), options.rom);
  const readyFile = path.join(runPath, 'release-ready');
  const scriptPath = path.join(runPath, 'scenario.lua');
  const debugScriptPath = path.join(runPath, 'resume.cmd');
  writeFileSync(scriptPath, createTi86MameGraphLinkScenarioScript({
    code: options.shellCode,
    scenario: options.scenario,
    readyFile,
    launchProgram: options.launchProgram,
    programNames: options.programNames,
    timeoutFrames: options.timeoutFrames,
  }));
  writeFileSync(debugScriptPath, 'go\n');
  const beforePtys = new Set(listPtys());
  const args = createTi86MameArguments({
    bios: options.romDescriptor.bios,
    romPath: romRoot,
    scriptPath,
    debugScriptPath,
    workPath: runPath,
  });
  removeArgument(args, '-nothrottle');
  removeArgumentPair(args, '-seconds_to_run');
  // Release acceptance deliberately uses normal TI-OS execution after the
  // virtual Graph Link transfer. It must never hide a RAM injection path
  // behind an otherwise green release report.
  removeArgument(args, '-debug');
  removeArgumentPair(args, '-debugger');
  removeArgumentPair(args, '-debugscript');
  args.push('-linkport', 'glinkhle', '-linkport:glinkhle:rs232', 'pty');
  args.push('-seconds_to_run', '360');
  const child = spawn(options.mame, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, SDL_VIDEODRIVER: 'dummy', SDL_AUDIODRIVER: 'dummy' },
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line.startsWith('SCHOOLCALC_HEARTBEAT ')) writeLine(`[ti86:mame] ${line}`);
    }
  });
  child.stderr.on('data', (chunk) => { output += chunk; });
  try {
    const pty = await waitForPty(beforePtys, () => output, options.startupTimeoutMs);
    writeLine(`[ti86:mame] ${options.scenario.id}: Graph Link ${pty}`);
    await delay(options.linkReadyDelayMs);
    const releaseFiles = options.manifest.transfer.map((entry) => {
      writeLine(`[ti86:mame] ${options.scenario.id}: queueing ${entry.fileName}`);
      return path.join(options.bundle, entry.fileName);
    });
    const result = await runGraphLinkTransfer({
      command: options.graphLink,
      files: releaseFiles,
      device: pty,
      timeoutMs: options.transferTimeoutMs,
      onProgress: (seconds) => writeLine(`[ti86:mame] ${options.scenario.id}: transfer active (${seconds}s)`),
    });
    if (result.code !== 0) {
      throw new Error(`MAME release transfer failed: ${result.output} MAME=${tail(output)}`);
    }
    writeFileSync(readyFile, `${options.manifest.releaseId}\n`);
    const execution = await waitForChild(child, options.scenarioTimeoutMs, () => output);
    if (execution.code !== 0) throw new Error(`MAME exited ${execution.code}: ${tail(output)}`);
    const parsed = parseTi86MameScenarioOutput(output, options.scenario, { requireSchoolCalcBoot: true });
    assertSemanticFrames(parsed);
    const frameDirectory = path.join(options.output, options.scenario.id);
    mkdirSync(frameDirectory, { recursive: true });
    const frames = [];
    for (const frame of parsed.frames.values()) {
      const png = renderFramebuffer(frame.pixels, options.pixelScale);
      const fileName = `${frame.capture}.png`;
      const asciiFileName = `${frame.capture}.txt`;
      writeFileSync(path.join(frameDirectory, fileName), png);
      writeFileSync(path.join(frameDirectory, asciiFileName), renderTi86FramebufferAscii(frame.pixels));
      frames.push({ capture: frame.capture, pc: frame.pc, sha256: frame.sha256, fileName, asciiFileName });
    }
    return {
      id: options.scenario.id,
      description: options.scenario.description,
      shellSha256: sha256(readFileSync(path.join(options.bundle, 'SCHLCALC.86p'))),
      frames,
    };
  } catch (error) {
    writeFileSync(path.join(runPath, 'harness-error.log'), `${error.stack ?? error.message}\n`);
    throw error;
  } finally {
    writeFileSync(path.join(runPath, 'mame-output.log'), output);
    if (child.exitCode == null && child.signalCode == null) {
      child.kill('SIGTERM');
      await waitForExit(child, 2_000, true);
    }
    if (options.keepTemp) writeLine(`[ti86:mame] kept ${runPath}`);
  }
}

function assertSemanticFrames(parsed) {
  for (const step of parsed.scenario.steps) {
    if (step.expectText.length === 0 && step.expectNotText.length === 0 && step.expectSymbols.length === 0) continue;
    const frame = parsed.frames.get(step.capture);
    const decoded = decodeTi86Screen(frame.pixels);
    const text = decoded.text.map((run) => run.text);
    const symbols = decoded.symbols.map((symbol) => symbol.symbol);
    for (const expected of step.expectText) {
      if (!text.some((value) => value.includes(expected))) {
        throw new Error(`MAME scenario '${parsed.scenario.id}' '${step.capture}' expected text '${expected}', got ${JSON.stringify(text)}`);
      }
    }
    for (const forbidden of step.expectNotText) {
      if (text.some((value) => value.includes(forbidden))) {
        throw new Error(`MAME scenario '${parsed.scenario.id}' '${step.capture}' unexpectedly retained text '${forbidden}', got ${JSON.stringify(text)}`);
      }
    }
    for (const expected of step.expectSymbols) {
      if (!symbols.some((value) => value.includes(expected))) {
        throw new Error(`MAME scenario '${parsed.scenario.id}' '${step.capture}' expected symbol '${expected}', got ${JSON.stringify(symbols)}`);
      }
    }
  }
}

function renderFramebuffer(bytes, scale) {
  const canvas = createCanvas(128 * scale, 64 * scale);
  const context = canvas.getContext('2d');
  context.fillStyle = '#cfd8b5';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#17241b';
  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 128; x += 1) {
      const byte = bytes[(y * 16) + (x >>> 3)];
      if (byte & (0x80 >>> (x & 7))) context.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  return canvas.toBuffer('image/png');
}

function validateManifest(manifest, bundle) {
  if (manifest?.schema !== 'school.calc.ti86-complete-install/v1') {
    throw new Error('invalid complete-install manifest');
  }
  for (const entry of manifest.transfer ?? []) {
    const file = path.join(bundle, entry.fileName);
    if (!existsSync(file) || sha256(readFileSync(file)) !== entry.sha256) {
      throw new Error(`release file ${entry.fileName} is missing or changed`);
    }
  }
}

function listPtys() {
  return readdirSync('/dev').filter((name) => /^ttys[0-9A-Za-z]+$/.test(name)).map((name) => `/dev/${name}`);
}

async function waitForPty(before, output, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const fromOutput = output().match(/(\/dev\/ttys[0-9A-Za-z]+)/)?.[1];
    if (fromOutput) return fromOutput;
    const fresh = listPtys().find((candidate) => !before.has(candidate));
    if (fresh) return fresh;
    await delay(100);
  }
  throw new Error(`MAME did not expose a Graph Link PTY: ${tail(output())}`);
}

function runGraphLinkTransfer({ command, files, device, timeoutMs, onProgress = () => {} }) {
  if (!Array.isArray(files) || files.length === 0) throw new Error('Graph Link transfer requires release files');
  return new Promise((resolve) => {
    const child = spawn(command, ['send', ...files], {
      env: { ...process.env, TI86_CABLE_DEVICE: device },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let timedOut = false;
    let hardStop = null;
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    const startedAt = Date.now();
    const progress = setInterval(() => onProgress(Math.floor((Date.now() - startedAt) / 1000)), 5_000);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      hardStop = setTimeout(() => child.kill('SIGKILL'), 1_000);
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      clearInterval(progress);
      if (hardStop) clearTimeout(hardStop);
      resolve({ code: 1, output: error.message });
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      clearInterval(progress);
      if (hardStop) clearTimeout(hardStop);
      resolve({
        code: timedOut ? 1 : (code ?? 1),
        output: timedOut ? `transfer timed out after ${timeoutMs}ms: ${output.trim()}` : output.trim(),
        signal,
      });
    });
  });
}

function waitForChild(child, timeoutMs, output) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`MAME scenario timed out: ${tail(output())}`));
    }, timeoutMs);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
}

function waitForExit(child, timeoutMs, force = false) {
  if (child.exitCode != null || child.signalCode != null) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(hardStop);
      resolve();
    };
    const timer = setTimeout(() => {
      if (force && child.exitCode == null && child.signalCode == null) child.kill('SIGKILL');
      hardStop = setTimeout(finish, 1_000);
    }, timeoutMs);
    let hardStop = null;
    child.once('exit', finish);
  });
}

function removeArgumentPair(args, name) {
  const index = args.indexOf(name);
  if (index >= 0) args.splice(index, 2);
}

function removeArgument(args, name) {
  const index = args.indexOf(name);
  if (index >= 0) args.splice(index, 1);
}

function parseArguments(args) {
  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--keep-temp') { flags.add(token); continue; }
    if (!token.startsWith('--') || index + 1 >= args.length) usage();
    values.set(token, args[index + 1]);
    index += 1;
  }
  if (!values.get('--rom') || !values.get('--bundle')) usage();
  const only = new Set((values.get('--scenario') ?? '').split(',').filter(Boolean));
  return {
    rom: path.resolve(values.get('--rom')),
    bundle: path.resolve(values.get('--bundle')),
    scenarios: path.resolve(values.get('--scenarios') ?? path.join(EXTENSION, 'testing', 'mame-scenarios.yml')),
    output: path.resolve(values.get('--output') ?? path.join(EXTENSION, 'dist', 'mame-scenarios')),
    graphLink: path.resolve(values.get('--graph-link') ?? '/private/tmp/ti86-graph-link-next'),
    mame: values.get('--mame') ?? 'mame',
    launchProgram: values.get('--launch') ?? null,
    only,
    pixelScale: Number.parseInt(values.get('--pixel-scale') ?? '4', 10),
    timeoutFrames: Number.parseInt(values.get('--timeout-frames') ?? '18000', 10),
    startupTimeoutMs: 15_000,
    linkReadyDelayMs: 3_000,
    transferTimeoutMs: 240_000,
    scenarioTimeoutMs: 360_000,
    keepTemp: flags.has('--keep-temp'),
  };
}

function usage() {
  process.stderr.write('Usage: node ti86-mame-scenario-harness.mjs --rom TI86.rom --bundle RELEASE_DIR '
    + '[--scenario ID[,ID]] [--launch PROGRAM] [--scenarios FILE.yml] [--graph-link TOOL] [--output DIR] [--keep-temp]\n');
  process.exit(64);
}

function tail(value) { return String(value ?? '').trim().split(/\r?\n/).slice(-12).join(' | '); }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function writeLine(message) { process.stdout.write(`${message}\n`); }
