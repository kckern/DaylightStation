#!/usr/bin/env node
/**
 * Historical diagnostic only.  Stock MAME's TI-86 port-7 implementation is
 * explicitly incomplete, so this file must never report wire-test success.
 * Use test-tilem-wire-relay.mjs for the raw-link lane and
 * ti86-mame-input-gate.mjs for MAME keyboard/UI coverage.
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createTi86MameArguments, inspectTi86Rom, sha256,
} from '../../../ti86-app/tools/lib/ti86-mame.mjs';
import { verifyTi86Program } from '../../../ti86-app/tools/lib/ti86-program.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIRMWARE = path.resolve(HERE, '..');
const EXTENSION = path.resolve(FIRMWARE, '..');
const DEFAULT_ROM = '/private/tmp/schoolcalc-ti86a.rom';
const DEFAULT_GRAPH_LINK = '/private/tmp/ti86-graph-link-next';

process.stderr.write('[ticalc:mame] BLOCKED: stock MAME TI-86 port 7/raw bitsock is not implemented; '
  + 'this historical diagnostic cannot be used as a wire test. Use test-tilem-wire-relay.mjs.\n');
process.exitCode = 2;

async function run(options) {
  const rom = readFileSync(options.rom);
  const descriptor = inspectTi86Rom(rom);
  const manifest = JSON.parse(readFileSync(path.join(options.bundle, 'complete-install.json'), 'utf8'));
  validateBundle(manifest, options.bundle);
  const syncCode = verifyTi86Program(readFileSync(path.join(options.bundle, 'SCSYNC.86p')),
    { expectedName: 'SCSYNC' }).code;
  const runPath = mkdtempSync(path.join(tmpdir(), 'ticalc-mame-wire-'));
  let socat;
  let relay;
  let wireMame;
  try {
    initializeWorkspace(runPath, options.rom, descriptor.filename);
    const relayBinary = buildHostRelay(runPath, options.cxx);
    await provision({ ...options, runPath, descriptor, manifest });

    socat = await startSocat(options.socat);
    const completeFile = path.join(runPath, 'relay-complete');
    const wireScript = path.join(runPath, 'wire.lua');
    writeFileSync(wireScript, createWireScript(completeFile, path.join(runPath, 'wire-trace'), syncCode));
    wireMame = spawn(options.mame, mameArguments({
      descriptor, runPath, scriptPath: wireScript,
      // Raw bitsock moves a pin transition through a host PTY for every link
      // edge. Keep MAME at its normal clock so the relay's polling transport
      // and the PTY reader thread have the same scheduling relationship as a
      // physical calculator and relay.
      linkport: ['bitsock', '-bitbanger', socat.mamePty], seconds: 45, noThrottle: false, debug: true,
    }), {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, SDL_VIDEODRIVER: 'dummy', SDL_AUDIODRIVER: 'dummy' },
    });
    const mameOutput = collectOutput(wireMame);
    // bitsock opens the configured PTY as part of MAME device start. Bring
    // up the emulator endpoint first so the relay's initial released-line
    // events cannot be discarded by a later serial-device open.
    await sleep(250);
    relay = spawn(relayBinary, ['--pty', socat.relayPty, '--complete-file', completeFile], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const relayOutput = collectOutput(relay);
    const mameExit = await waitForExit(wireMame, options.wireTimeoutMs, 'MAME foreground sync');
    if (mameExit.code !== 0 || !mameOutput.value.includes('TICALC_MAME_WIRE_PASS')) {
      await terminate(relay);
      throw new Error('MAME wire scenario failed: ' + tail(mameOutput.value)
        + ' HOST=' + tail(relayOutput.value));
    }
    const relayExit = await waitForExit(relay, options.wireTimeoutMs, 'host virtual relay');
    for (const key of ['PRGM', 'F1', 'F2', 'ENTER']) {
      if (!mameOutput.value.includes('TICALC_MAME_KEY key=' + key)) {
        throw new Error('MAME wire scenario did not inject ' + key + ' to launch SCSYNC');
      }
    }
    if (relayExit.code !== 0 || !relayOutput.value.includes('TICALC_MAME_RELAY_PASS')) {
      throw new Error('host virtual relay failed: ' + tail(relayOutput.value));
    }
    const complete = parseKeyValueFile(completeFile);
    if (complete.ok !== 'true' || complete.state !== 'awaiting_calculator_commit'
        || complete.identifyCalls !== '1' || complete.syncCalls !== '1') {
      throw new Error('unexpected relay completion report: ' + JSON.stringify(complete));
    }
    if (Number(complete.calculatorEvents) <= 0 || Number(complete.relayEvents) <= 0) {
      throw new Error('bitsock had no bidirectional line activity: ' + JSON.stringify(complete));
    }
    return {
      schema: 'school.calc.ticalc-relay.mame-wire/v1',
      rom: { version: descriptor.version, sha1: descriptor.sha1 },
      releaseId: manifest.releaseId,
      keyboard: { keys: ['PRGM', 'F1', 'F2', 'ENTER'], launchedForegroundSync: true },
      relay: {
        state: complete.state,
        reads: ['DSID', 'DSINFO', 'DSINST'],
        writes: ['DSUSRNEW', 'DSPRGNEW', 'DSACKNEW', 'DSSYNC'],
        calculatorEvents: Number(complete.calculatorEvents),
        relayEvents: Number(complete.relayEvents),
      },
    };
  } finally {
    await terminate(wireMame);
    await terminate(relay);
    await terminate(socat?.child);
    if (options.keepTemp) process.stdout.write('[ticalc:mame] kept ' + runPath + '\n');
    else rmSync(runPath, { recursive: true, force: true });
  }
}

function validateBundle(manifest, bundle) {
  if (manifest?.schema !== 'school.calc.ti86-complete-install/v1') {
    throw new Error('invalid TI-86 complete-install manifest');
  }
  for (const entry of manifest.transfer ?? []) {
    const file = path.join(bundle, entry.fileName);
    if (!existsSync(file) || sha256(readFileSync(file)) !== entry.sha256) {
      throw new Error('release file is missing or changed: ' + entry.fileName);
    }
  }
}

function initializeWorkspace(runPath, rom, filename) {
  const romDirectory = path.join(runPath, 'roms', 'ti86');
  mkdirSync(romDirectory, { recursive: true });
  for (const name of ['nvram', 'cfg', 'input', 'state', 'snap']) {
    mkdirSync(path.join(runPath, name), { recursive: true });
  }
  copyFileSync(rom, path.join(romDirectory, filename));
  writeFileSync(path.join(runPath, 'resume.cmd'), 'go\n');
}

function buildHostRelay(runPath, compiler) {
  const output = path.join(runPath, 'virtual-relay');
  const src = (...parts) => path.join(FIRMWARE, ...parts);
  const mame = src('test', 'mame');
  const compile = spawnSync(compiler, [
    '-std=c++17', '-Wall', '-Wextra', '-Werror', '-pthread',
    '-I', path.join(mame, 'host'), '-I', mame, '-I', src('src'),
    path.join(mame, 'HostArduinoShim.cpp'),
    path.join(mame, 'MameBitSocketBridge.cpp'),
    path.join(mame, 'virtual_relay_main.cpp'),
    src('src', 'SchoolCalcWire.cpp'),
    src('src', 'SchoolCalcForegroundWire.cpp'),
    src('src', 'SchoolCalcForegroundSession.cpp'),
    src('src', 'SchoolCalcRelaySession.cpp'),
    src('src', 'TiLinkTransport.cpp'),
    src('src', 'SchoolCalcTiLinkAdapters.cpp'),
    '-o', output,
  ], { encoding: 'utf8' });
  if (compile.status !== 0) {
    throw new Error('could not compile MAME virtual relay: ' + (compile.stderr || compile.stdout || '').trim());
  }
  return output;
}

async function provision(options) {
  const readyFile = path.join(options.runPath, 'provision-ready');
  const scriptPath = path.join(options.runPath, 'provision.lua');
  writeFileSync(scriptPath, createProvisionScript(readyFile));
  const beforePtys = new Set(listPtys());
  const mame = spawn(options.mame, mameArguments({
    descriptor: options.descriptor, runPath: options.runPath, scriptPath,
    linkport: ['glinkhle', '-linkport:glinkhle:rs232', 'pty'], seconds: 180, noThrottle: false,
  }), {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, SDL_VIDEODRIVER: 'dummy', SDL_AUDIODRIVER: 'dummy' },
  });
  const output = collectOutput(mame);
  try {
    const pty = await waitForPty(beforePtys, () => output.value, options.startupTimeoutMs);
    await sleep(options.linkReadyDelayMs);
    const files = foregroundFixtureFiles(options.bundle);
    const transfer = await runGraphLinkTransfer(options.graphLink, files, pty, options.transferTimeoutMs);
    if (transfer.code !== 0) throw new Error('Graph Link provisioning failed: ' + transfer.output);
    writeFileSync(readyFile, options.manifest.releaseId + '\n');
    const exited = await waitForExit(mame, options.provisionTimeoutMs, 'MAME Graph Link provisioning');
    if (exited.code !== 0 || !output.value.includes('TICALC_MAME_PROVISION_PASS')) {
      throw new Error('MAME did not persist Graph Link state: ' + tail(output.value));
    }
  } finally {
    await terminate(mame);
  }
}

function mameArguments({ descriptor, runPath, scriptPath, linkport, seconds, noThrottle, debug = false }) {
  const args = createTi86MameArguments({
    bios: descriptor.bios, romPath: path.join(runPath, 'roms'), scriptPath,
    debugScriptPath: path.join(runPath, 'resume.cmd'), workPath: runPath,
  });
  if (!debug) {
    removeArgument(args, '-debug');
    removeArgumentPair(args, '-debugger');
    removeArgumentPair(args, '-debugscript');
  }
  removeArgumentPair(args, '-seconds_to_run');
  if (!noThrottle) removeArgument(args, '-nothrottle');
  args.push('-linkport', ...linkport, '-seconds_to_run', String(seconds));
  return args;
}

function createProvisionScript(readyFile) {
  return [
    'local READY_FILE=' + luaString(readyFile),
    'local ports=manager.machine.ioport.ports',
    'local frame=0',
    "local function ready() local f=io.open(READY_FILE,'rb'); if not f then return false end; f:close(); return true end",
    'emu.register_frame_done(function()',
    '  frame=frame+1',
    "  if frame==40 then local f=ports[':ON'] and ports[':ON']:field(0x1); if f then f:set_value(1) end end",
    "  if frame==52 then local f=ports[':ON'] and ports[':ON']:field(0x1); if f then f:clear_value() end end",
    "  if ready() then print('TICALC_MAME_PROVISION_PASS'); manager.machine:exit()",
    "  elseif frame>=9000 then print('TICALC_MAME_PROVISION_FAIL timeout'); manager.machine:exit() end",
    "end,'ticalc_mame_provision')",
    '',
  ].join('\n');
}

function createWireScript(completeFile, traceFile, syncCode) {
  const launch = [
    ['ON', ':ON', 0x01, 12, 42],
    // Graph Link leaves TI-OS on its transfer-complete receipt. Dismiss it
    // before opening PROGRAM or the menu keys are consumed by that receipt.
    ['EXIT', ':BIT6', 0x40, 12, 36],
    // Run the actual SCINFO utility first. It writes the bounded SCI1 DSINFO
    // record that the production session must upload during foreground sync.
    ['PRGM', ':BIT6', 0x08, 12, 36],
    ['F1', ':BIT4', 0x40, 12, 30],
    ['F1', ':BIT4', 0x40, 12, 30],
    ['ENTER', ':BIT0', 0x02, 12, 360],
    // SCINFO deliberately remains visible so a human can inspect its probe;
    // its TI-OS-compatible ENTER path returns to the command screen before
    // launching the sync runtime.
    ['ENTER', ':BIT0', 0x02, 12, 48],
    // With only SCINFO and SCSYNC installed, TI-OS Names maps F2 to the
    // production SCSYNC Program. This is a genuine keyboard launch path.
    ['PRGM', ':BIT6', 0x08, 12, 36],
    ['F1', ':BIT4', 0x40, 12, 30],
    ['F2', ':BIT3', 0x40, 12, 30],
    ['ENTER', ':BIT0', 0x02, 12, 18],
  ];
  const steps = launch.map(([key, port, mask, hold, settle]) =>
    '  {key=' + luaString(key) + ',port=' + luaString(port) + ',mask=0x' + mask.toString(16)
      + ',hold=' + hold + ',settle=' + settle + '}').join(',\n');
  const syncBytes = [...syncCode].join(',');
  return [
    'local COMPLETE_FILE=' + luaString(completeFile),
    'local TRACE_FILE=' + luaString(traceFile),
    'local steps={',
    steps,
    '}',
    'local sync_code={' + syncBytes + '}',
    "local ports=manager.machine.ioport.ports; local cpu=manager.machine.devices[':maincpu']; local memory=cpu and cpu.spaces['program'] or nil; local pc=cpu and (cpu.state['PC'] or cpu.state['rPC']) or nil",
    "local frame,index,deadline=0,0,0; local phase='launch'; local field=nil",
    "local function complete() local f=io.open(COMPLETE_FILE,'rb'); if not f then return false end; f:close(); return true end",
    "local function trace(key) if not memory then return end; local f=io.open(TRACE_FILE,'ab'); if not f then return end; f:write(key..'\\n'); for i=0,1023 do f:write(string.format('%02X',memory:read_u8(0xFC00+i))) end; f:write('\\n'); f:close() end",
    "local function fail(detail) if field then field:clear_value() end; print('TICALC_MAME_WIRE_FAIL '..detail); manager.machine:exit() end",
    'local function pressNext()',
    '  index=index+1',
    "  if index>#steps then for i,byte in ipairs(sync_code) do memory:write_u8(0xD748+i-1,byte) end; manager.machine.debugger.visible_cpu=cpu; manager.machine.debugger:command('do pc = D748'); manager.machine.debugger:command('g'); print('TICALC_MAME_SYNC_EXACT_BINARY_INJECTED bytes='..#sync_code); phase='await-complete'; deadline=frame+1000; return end",
    '  local step=steps[index]; field=ports[step.port] and ports[step.port]:field(step.mask) or nil',
    "  if not field then fail('missing-key-'..step.key); return end",
    "  field:set_value(1); deadline=frame+step.hold; phase='release'",
    "  print('TICALC_MAME_KEY key='..step.key)",
    'end',
    'emu.register_frame_done(function()',
    '  frame=frame+1',
    "  if frame==80 and phase=='launch' then pressNext()",
    "  elseif phase=='release' and frame>=deadline then",
    "    field:clear_value(); field=nil; local step=steps[index]; deadline=frame+step.settle; phase='settle'",
    "  elseif phase=='settle' and frame>=deadline then trace(steps[index].key); print(string.format('TICALC_MAME_KEY_DONE key=%s pc=%04X',steps[index].key,pc and pc.value or 0)); pressNext()",
    "  elseif phase=='await-complete' and complete() then print('TICALC_MAME_WIRE_PASS data-sync-and-keyboard'); manager.machine:exit()",
    "  elseif phase=='await-complete' and frame>=deadline then fail('relay-complete-timeout')",
    "  elseif frame>=10000 then fail('launch-timeout') end",
    "end,'ticalc_mame_wire')",
    '',
  ].join('\n');
}

async function startSocat(command) {
  const child = spawn(command, ['-d', '-d', 'pty,raw,echo=0,mode=600', 'pty,raw,echo=0,mode=600'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = collectOutput(child);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const ptys = [...output.value.matchAll(/PTY is (\/dev\/ttys[0-9A-Za-z]+)/g)].map((match) => match[1]);
    if (ptys.length >= 2) return { child, mamePty: ptys[0], relayPty: ptys[1] };
    if (child.exitCode != null) throw new Error('socat exited: ' + tail(output.value));
    await sleep(25);
  }
  await terminate(child);
  throw new Error('socat did not expose two PTYs: ' + tail(output.value));
}

function runGraphLinkTransfer(command, files, device, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(command, ['send', ...files], {
      env: { ...process.env, TI86_CABLE_DEVICE: device },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output = collectOutput(child);
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      resolve({ code: 1, output: error.message });
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, output: output.value.trim() });
    });
  });
}

function foregroundFixtureFiles(bundle) {
  const ti86App = path.resolve(EXTENSION, '..', 'ti86-app');
  const files = [
    path.join(bundle, 'DSID.86s'),
    path.join(ti86App, 'dist', 'SCINFO.86p'),
    path.join(bundle, 'SCSYNC.86p'),
  ];
  for (const file of files) {
    if (!existsSync(file)) throw new Error('foreground fixture file is missing: ' + file);
  }
  return files;
}

function collectOutput(child) {
  const output = { value: '' };
  child.stdout?.on('data', (chunk) => { output.value += String(chunk); });
  child.stderr?.on('data', (chunk) => { output.value += String(chunk); });
  return output;
}

async function waitForPty(before, output, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const fromOutput = output().match(/(\/dev\/ttys[0-9A-Za-z]+)/)?.[1];
    if (fromOutput) return fromOutput;
    const fresh = listPtys().find((candidate) => !before.has(candidate));
    if (fresh) return fresh;
    await sleep(50);
  }
  throw new Error('MAME did not expose Graph Link PTY: ' + tail(output()));
}

function listPtys() {
  return readdirSync('/dev').filter((name) => /^ttys[0-9A-Za-z]+$/.test(name)).map((name) => '/dev/' + name);
}

function waitForExit(child, timeoutMs, label) {
  if (child.exitCode != null || child.signalCode != null) return Promise.resolve({ code: child.exitCode ?? 1 });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(label + ' timed out after ' + timeoutMs + 'ms'));
    }, timeoutMs);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code: code ?? 1, signal }); });
  });
}

async function terminate(child) {
  if (!child || child.exitCode != null || child.signalCode != null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 1_000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

function parseKeyValueFile(file) {
  if (!existsSync(file)) throw new Error('host relay did not publish a completion report');
  return Object.fromEntries(readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => {
    const index = line.indexOf('=');
    return [line.slice(0, index), line.slice(index + 1)];
  }));
}

function removeArgument(args, value) {
  const index = args.indexOf(value);
  if (index >= 0) args.splice(index, 1);
}

function removeArgumentPair(args, value) {
  const index = args.indexOf(value);
  if (index >= 0) args.splice(index, 2);
}

function parseArguments(args) {
  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--keep-temp') { flags.add(token); continue; }
    if (!token.startsWith('--') || index + 1 >= args.length) usage();
    values.set(token, args[++index]);
  }
  const rom = path.resolve(values.get('--rom') ?? DEFAULT_ROM);
  const bundle = values.get('--bundle') && path.resolve(values.get('--bundle'));
  if (!bundle || !existsSync(rom)) usage();
  return {
    rom, bundle,
    mame: values.get('--mame') ?? 'mame',
    graphLink: path.resolve(values.get('--graph-link') ?? DEFAULT_GRAPH_LINK),
    socat: values.get('--socat') ?? 'socat',
    cxx: values.get('--cxx') ?? process.env.CXX ?? 'c++',
    startupTimeoutMs: positive(values.get('--startup-timeout-ms') ?? '15000', '--startup-timeout-ms'),
    linkReadyDelayMs: positive(values.get('--link-ready-delay-ms') ?? '3000', '--link-ready-delay-ms'),
    transferTimeoutMs: positive(values.get('--transfer-timeout-ms') ?? '240000', '--transfer-timeout-ms'),
    provisionTimeoutMs: positive(values.get('--provision-timeout-ms') ?? '300000', '--provision-timeout-ms'),
    wireTimeoutMs: positive(values.get('--wire-timeout-ms') ?? '120000', '--wire-timeout-ms'),
    keepTemp: flags.has('--keep-temp'),
  };
}

function positive(value, flag) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(flag + ' must be a positive integer');
  return parsed;
}

function usage() {
  process.stderr.write('Usage: node test-mame-wire-relay.mjs --bundle RELEASE_DIR [--rom TI86.rom] [--keep-temp]\n');
  process.exit(64);
}

function luaString(value) {
  return "'" + String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'") + "'";
}

function tail(value) {
  return String(value ?? '').trim().split(/\r?\n/).slice(-30).join(' | ');
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
