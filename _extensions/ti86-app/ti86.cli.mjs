#!/usr/bin/env node
/**
 * Headless TI-86 console for exercising an exact SchoolCalc release in MAME.
 *
 * Example:
 *   node _extensions/ti86-app/ti86.cli.mjs \
 *     --rom /private/tmp/schoolcalc-ti86a.rom \
 *     --bundle _extensions/ti86-app/dist/install-ti86a-f77e52f87733 \
 *     --load ASCHL --keys DOWN,ENTER,F2 --screens each --screen hybrid
 *
 * The calculator receives the real .86p/.86s transfer on MAME's virtual
 * Graph Link. LCD output is read directly from $FC00.  The default terminal
 * view sweeps all SchoolCalc typefaces at every valid x/y offset, reports the
 * text at its true origin/polarity, then maps the remaining graphics to
 * Unicode Braille.  Exact `.` / `█` pixels remain available for auditing.
 */
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTi86MameArguments, inspectTi86Rom, sha256 } from './tools/lib/ti86-mame.mjs';
import { renderTi86FramebufferAscii } from './tools/lib/ti86-mame-scenario.mjs';
import {
  renderTi86ScreenBraille,
  renderTi86ScreenHybrid,
  renderTi86ScreenText,
} from './tools/lib/ti86-screen-text.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROM = '/private/tmp/schoolcalc-ti86a.rom';
const DEFAULT_GRAPH_LINK = '/private/tmp/ti86-graph-link-next';
const LCD_ADDRESS = 0xFC00;
const LCD_BYTES = 1024;

// These are MAME's TI-86 input fields, verified against MAME's ti85.cpp;
// the TI-86 machine uses its ti85 input definition.
const KEYS = Object.freeze({
  DOWN: [':BIT0', 0x01], ENTER: [':BIT0', 0x02], NEG: [':BIT0', 0x04], DOT: [':BIT0', 0x08], '0': [':BIT0', 0x10], F5: [':BIT0', 0x40],
  LEFT: [':BIT1', 0x01], PLUS: [':BIT1', 0x02], '3': [':BIT1', 0x04], '2': [':BIT1', 0x08], '1': [':BIT1', 0x10], STORE: [':BIT1', 0x20], F4: [':BIT1', 0x40],
  RIGHT: [':BIT2', 0x01], MINUS: [':BIT2', 0x02], '6': [':BIT2', 0x04], '5': [':BIT2', 0x08], '4': [':BIT2', 0x10], COMMA: [':BIT2', 0x20], F3: [':BIT2', 0x40],
  UP: [':BIT3', 0x01], TIMES: [':BIT3', 0x02], '9': [':BIT3', 0x04], '8': [':BIT3', 0x08], '7': [':BIT3', 0x10], SQUARE: [':BIT3', 0x20], F2: [':BIT3', 0x40],
  DIVIDE: [':BIT4', 0x02], RPAREN: [':BIT4', 0x04], LPAREN: [':BIT4', 0x08], EE: [':BIT4', 0x10], LN: [':BIT4', 0x20], F1: [':BIT4', 0x40],
  POWER: [':BIT5', 0x02], TAN: [':BIT5', 0x04], COS: [':BIT5', 0x08], SIN: [':BIT5', 0x10], LOG: [':BIT5', 0x20], SECOND: [':BIT5', 0x40],
  CLEAR: [':BIT6', 0x02], CUSTOM: [':BIT6', 0x04], PRGM: [':BIT6', 0x08], STAT: [':BIT6', 0x10], GRAPH: [':BIT6', 0x20], EXIT: [':BIT6', 0x40],
  DEL: [':BIT7', 0x08], XVAR: [':BIT7', 0x10], ALPHA: [':BIT7', 0x20], MORE: [':BIT7', 0x40], ON: [':ON', 0x01],
});

const ALPHA = Object.freeze({
  A: 'LOG', B: 'SIN', C: 'COS', D: 'TAN', E: 'POWER', F: 'LN', G: 'EE', H: 'LPAREN', I: 'RPAREN', J: 'DIVIDE',
  K: 'SQUARE', L: '7', M: '8', N: '9', O: 'TIMES', P: 'COMMA', Q: '4', R: '5', S: '6', T: 'MINUS',
  U: '1', V: '2', W: '3', X: 'STORE', Y: '0', Z: 'DOT',
});

try {
  const options = parseArgs(process.argv.slice(2));
  const result = await run(options);
  if (options.output) {
    mkdirSync(path.dirname(options.output), { recursive: true });
    writeFileSync(options.output, result);
  }
  process.stdout.write(result);
} catch (error) {
  process.stderr.write(`[ti86:cli] ${error.stack ?? error.message}\n`);
  process.exitCode = 1;
}

async function run(options) {
  const rom = readFileSync(options.rom);
  const descriptor = inspectTi86Rom(rom);
  const manifest = JSON.parse(readFileSync(path.join(options.bundle, 'complete-install.json'), 'utf8'));
  validateRelease(manifest, options.bundle);
  const runPath = mkdtempSync(path.join(tmpdir(), 'schoolcalc-ti86-cli-'));
  const romDirectory = path.join(runPath, 'roms', 'ti86');
  for (const directory of [
    romDirectory,
    path.join(runPath, 'nvram'),
    path.join(runPath, 'cfg'),
    path.join(runPath, 'input'),
    path.join(runPath, 'state'),
    path.join(runPath, 'snap'),
  ]) {
    mkdirSync(directory, { recursive: true });
  }
  writeFileSync(path.join(romDirectory, descriptor.filename), rom);
  const readyFile = path.join(runPath, 'release-ready');
  const luaPath = path.join(runPath, 'console.lua');
  const actions = buildActions(options, manifest);
  writeFileSync(luaPath, buildLua({ readyFile, actions, holdFrames: options.holdFrames, settleFrames: options.settleFrames, screens: options.screens }));

  const priorPtys = new Set(listPtys());
  const mameArgs = createTi86MameArguments({
    bios: descriptor.bios,
    romPath: path.join(runPath, 'roms'),
    scriptPath: luaPath,
    debugScriptPath: path.join(runPath, 'resume.cmd'),
    workPath: runPath,
  });
  remove(mameArgs, '-nothrottle');
  removePair(mameArgs, '-seconds_to_run');
  remove(mameArgs, '-debug');
  removePair(mameArgs, '-debugger');
  removePair(mameArgs, '-debugscript');
  mameArgs.push('-linkport', 'glinkhle', '-linkport:glinkhle:rs232', 'pty', '-seconds_to_run', '360');

  const mame = spawn(options.mame, mameArgs, {
    env: { ...process.env, SDL_VIDEODRIVER: 'dummy', SDL_AUDIODRIVER: 'dummy' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  mame.stdout.on('data', (chunk) => { output += chunk; });
  mame.stderr.on('data', (chunk) => { output += chunk; });
  try {
    const pty = await waitForPty(priorPtys, () => output, options.startupTimeoutMs);
    // MAME exposes the PTY slightly before its emulated Graph Link transport
    // is ready to negotiate.  Keep this aligned with the accepted scenario
    // harness or the first variable can fail with a TI link operation 4.
    await delay(options.linkReadyDelayMs);
    const transfer = selectedTransfer(manifest, options.transfer);
    process.stderr.write(`[ti86:cli] MAME TI-86 ${descriptor.version}; transferring ${transfer.length} release variables\n`);
    const files = transfer.map(({ fileName }) => path.join(options.bundle, fileName));
    const transferResult = await transferRelease(options.graphLink, files, pty, options.transferTimeoutMs);
    if (transferResult.code !== 0) throw new Error(`release transfer failed: ${transferResult.output}`);
    writeFileSync(readyFile, `${manifest.releaseId}\n`);
    const completion = await waitForExit(mame, options.scenarioTimeoutMs);
    if (completion.code !== 0) throw new Error(`MAME exited ${completion.code}: ${tail(output)}`);
    if (!output.includes('SCHOOLCALC_CLI_PASS')) throw new Error(`emulator console did not complete: ${tail(output)}`);
    const screens = parseCapturedScreens(output);
    if (screens.length === 0) throw new Error('emulator console emitted no LCD screen');
    return `${screens.map((screen) => formatScreen(screen, options.screen)).join('\n\n')}\n`;
  } finally {
    if (mame.exitCode == null && mame.signalCode == null) mame.kill('SIGTERM');
  }
}

function buildActions(options, manifest) {
  const actions = [];
  if (options.load) actions.push(...loadActions(options.load, manifest));
  // Child runtimes can need a short settle before the next key. Preserve the
  // input-option order rather than grouping keys, text, and waits by kind.
  for (const input of options.inputs) {
    if (input.kind === 'key') actions.push(...keyActions(input.value));
    if (input.kind === 'text') {
      for (const character of input.value) actions.push(...textActions(character));
    }
    if (input.kind === 'wait') actions.push({ kind: 'wait', frames: input.frames, label: `wait-${input.frames}` });
  }
  return actions;
}

function selectedTransfer(manifest, requested) {
  if (!requested) return manifest.transfer;
  const names = new Set(requested);
  const transfer = manifest.transfer.filter(({ fileName }) => names.has(path.basename(fileName, path.extname(fileName)).toUpperCase()));
  if (transfer.length !== names.size) {
    const present = new Set(transfer.map(({ fileName }) => path.basename(fileName, path.extname(fileName)).toUpperCase()));
    throw new Error(`--transfer includes an unknown release variable: ${[...names].filter((name) => !present.has(name)).join(', ')}`);
  }
  return transfer;
}

function loadActions(name, manifest) {
  const requested = String(name).trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]{0,7}$/.test(requested)) throw new Error('--load must be a TI program name');
  const programs = manifest.transfer
    .filter(({ kind }) => kind === 'program' || kind === 'basic-launcher')
    .map(({ fileName }) => path.basename(fileName, '.86p').toUpperCase())
    .sort();
  const index = programs.indexOf(requested);
  if (index < 0) throw new Error(`--load ${requested} is not in the release`);
  if (index > 4) throw new Error(`--load ${requested} is on a later TI-86 PROGRAM page; use --keys for this v0 console`);
  return [
    { kind: 'key', key: 'ON', label: 'wake-after-transfer' },
    { kind: 'key', key: 'EXIT', label: 'dismiss-transfer-receipt' },
    { kind: 'key', key: 'PRGM', label: 'program-menu' },
    { kind: 'key', key: 'F1', label: 'program-names' },
    { kind: 'key', key: `F${index + 1}`, label: `select-${requested}` },
    { kind: 'key', key: 'ENTER', label: `load-${requested}` },
  ];
}

function keyActions(input) {
  const key = String(input).trim().toUpperCase();
  if (KEYS[key]) return [{ kind: 'key', key, label: key.toLowerCase() }];
  if (ALPHA[key]) return [{ kind: 'key', key: 'ALPHA', label: `alpha-${key.toLowerCase()}` }, { kind: 'key', key: ALPHA[key], label: key.toLowerCase() }];
  throw new Error(`unknown TI-86 key '${input}'`);
}

function textActions(character) {
  if (character === ' ') throw new Error('--text does not support spaces on the TI-86 v0 console');
  if (/^[0-9]$/.test(character)) return keyActions(character);
  if (/^[A-Za-z]$/.test(character)) return keyActions(character.toUpperCase());
  if (character === '.') return keyActions('DOT');
  if (character === '-') return keyActions('MINUS');
  if (character === '+') return keyActions('PLUS');
  throw new Error(`--text cannot enter '${character}' on the TI-86 v0 console`);
}

function buildLua({ readyFile, actions, holdFrames, settleFrames, screens }) {
  const actionRows = actions.map((action) => action.kind === 'wait'
    ? `{ kind='wait', frames=${action.frames}, label=${lua(action.label)} }`
    : `{ kind='key', key=${lua(action.key)}, label=${lua(action.label)}, port=${lua(KEYS[action.key][0])}, mask=0x${KEYS[action.key][1].toString(16)} }`);
  return `local READY_FILE=${lua(readyFile)}\n`
    + `local HOLD=${holdFrames}\nlocal SETTLE=${settleFrames}\nlocal SCREENS=${screens === 'each' ? 'true' : 'false'}\n`
    + `local actions={${actionRows.join(',')}}\n`
    + `local cpu=manager.machine.devices[':maincpu']\nlocal memory=cpu and cpu.spaces['program'] or nil\nlocal pc=cpu and (cpu.state['PC'] or cpu.state['rPC']) or nil\nlocal ports=manager.machine.ioport.ports\n`
    + `local frame,index,phase,deadline,field=0,0,'wait-release',0,nil\nlocal shell_hit,shell_entry=false,0\n`
    + `local function capture(label)\n`
    + ` print(string.format('SCHOOLCALC_SCREEN_BEGIN label=%s pc=%04X executionWindow=%s',label,pc.value,tostring(shell_hit)))\n`
    + ` for y=0,63 do local row={} for x=0,127 do local byte=memory:read_u8(0xFC00+(y*16)+math.floor(x/8)); local bit=math.floor(byte/(2^(7-(x%8))))%2; row[#row+1]=bit==1 and '█' or '.' end print(table.concat(row)) end\n`
    + ` print('SCHOOLCALC_SCREEN_END')\nend\n`
    + `local function ready() local f=io.open(READY_FILE,'rb'); if not f then return false end; f:close(); return true end\n`
    + `local function next_action()\n`
    + ` index=index+1; if index>#actions then capture('final'); print('SCHOOLCALC_CLI_PASS'); manager.machine:exit(); return end\n`
    + ` local action=actions[index]; if action.kind=='wait' then deadline=frame+action.frames; phase='wait-action'; return end\n`
    + ` field=ports[action.port] and ports[action.port]:field(action.mask) or nil; if not field then print('SCHOOLCALC_CLI_FAIL missing-key-'..action.key); manager.machine:exit(); return end\n`
    + ` field:set_value(1); deadline=frame+HOLD; phase='release'\nend\n`
    + `emu.register_frame_done(function()\n`
    + ` frame=frame+1; if not cpu or not memory or not pc then print('SCHOOLCALC_CLI_FAIL cpu'); manager.machine:exit(); return end\n`
    + ` if pc.value>=0xD748 and pc.value<0xFC00 then if not shell_hit then shell_entry=pc.value end; shell_hit=true end\n`
    + ` if frame==40 then local wake=ports[':ON'] and ports[':ON']:field(0x1); if wake then wake:set_value(1) end\n`
    + ` elseif frame==52 then local wake=ports[':ON'] and ports[':ON']:field(0x1); if wake then wake:clear_value() end end\n`
    + ` if phase=='wait-release' and ready() then capture('transfer-complete'); next_action()\n`
    + ` elseif phase=='release' and frame>=deadline then field:clear_value(); field=nil; deadline=frame+SETTLE; phase='settle'\n`
    + ` elseif phase=='settle' and frame>=deadline then if SCREENS then capture(actions[index].label) end; next_action()\n`
    + ` elseif phase=='wait-action' and frame>=deadline then if SCREENS then capture(actions[index].label) end; next_action() end\n`
    + `end,'schoolcalc_cli')\n`;
}

function parseArgs(argv) {
  const values = new Map();
  const inputs = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') usage();
    if (token === '--screens' || token === '--screen') { values.set(token, argv[++index]); continue; }
    if (token === '--key') { inputs.push({ kind: 'key', value: argv[++index] }); continue; }
    if (token === '--keys') {
      for (const key of String(argv[++index]).split(/[\s,]+/).filter(Boolean)) inputs.push({ kind: 'key', value: key });
      continue;
    }
    if (token === '--text') { inputs.push({ kind: 'text', value: argv[++index] }); continue; }
    if (token === '--wait') { inputs.push({ kind: 'wait', frames: integer(argv[++index], '--wait') }); continue; }
    if (token === '--rom' || token === '--bundle' || token === '--load' || token === '--transfer' || token === '--mame' || token === '--graph-link' || token === '--output' || token === '--hold-frames' || token === '--settle-frames') { values.set(token, argv[++index]); continue; }
    throw new Error(`unknown option '${token}'`);
  }
  const screens = values.get('--screens') ?? 'final';
  if (!['final', 'each'].includes(screens)) throw new Error('--screens must be final or each');
  const screen = values.get('--screen') ?? 'hybrid';
  if (!['hybrid', 'text', 'braille', 'pixels'].includes(screen)) {
    throw new Error('--screen must be hybrid, text, braille, or pixels');
  }
  const rom = path.resolve(values.get('--rom') ?? DEFAULT_ROM);
  const bundle = values.get('--bundle') && path.resolve(values.get('--bundle'));
  if (!bundle) usage('--bundle is required');
  if (!existsSync(rom)) throw new Error(`TI-86 ROM not found: ${rom}`);
  if (!existsSync(bundle)) throw new Error(`release bundle not found: ${bundle}`);
  return {
    rom, bundle, inputs, screens, screen,
    transfer: values.get('--transfer') ? String(values.get('--transfer')).split(/[\s,]+/).filter(Boolean).map((name) => name.toUpperCase()) : null,
    output: values.get('--output') ? path.resolve(values.get('--output')) : null,
    load: values.get('--load') ?? null,
    mame: values.get('--mame') ?? 'mame',
    graphLink: path.resolve(values.get('--graph-link') ?? DEFAULT_GRAPH_LINK),
    holdFrames: integer(values.get('--hold-frames') ?? 12, '--hold-frames'),
    settleFrames: integer(values.get('--settle-frames') ?? 24, '--settle-frames'),
    startupTimeoutMs: 15_000,
    linkReadyDelayMs: 3_000,
    transferTimeoutMs: 240_000,
    scenarioTimeoutMs: 360_000,
  };
}

function validateRelease(manifest, bundle) {
  if (manifest?.schema !== 'school.calc.ti86-complete-install/v1') throw new Error('invalid complete-install manifest');
  for (const entry of manifest.transfer ?? []) {
    const file = path.join(bundle, entry.fileName);
    if (!existsSync(file) || sha256(readFileSync(file)) !== entry.sha256) throw new Error(`release file missing or changed: ${entry.fileName}`);
  }
}

function listPtys() { return readdirSync('/dev').filter((name) => /^ttys[0-9A-Za-z]+$/.test(name)).map((name) => `/dev/${name}`); }

async function waitForPty(existing, output, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const fromOutput = output().match(/(\/dev\/ttys[0-9A-Za-z]+)/)?.[1];
    if (fromOutput) return fromOutput;
    const fresh = listPtys().find((candidate) => !existing.has(candidate));
    if (fresh) return fresh;
    await delay(100);
  }
  throw new Error(`MAME did not expose a Graph Link PTY: ${tail(output())}`);
}

function transferRelease(command, files, device, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(command, ['send', ...files], { env: { ...process.env, TI86_CABLE_DEVICE: device }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.once('error', (error) => { clearTimeout(timer); resolve({ code: 1, output: error.message }); });
    child.once('exit', (code) => { clearTimeout(timer); resolve({ code: code ?? 1, output: output.trim() }); });
  });
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('MAME console timed out')); }, timeoutMs);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
}

function remove(args, token) { const index = args.indexOf(token); if (index >= 0) args.splice(index, 1); }
function removePair(args, token) { const index = args.indexOf(token); if (index >= 0) args.splice(index, 2); }
function integer(value, name) { const result = Number.parseInt(value, 10); if (!Number.isInteger(result) || result < 1) throw new Error(`${name} must be a positive integer`); return result; }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function lua(value) { return `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`; }
function tail(value) { return String(value).slice(-2000); }
function parseCapturedScreens(output) {
  const screens = [];
  const expression = /^SCHOOLCALC_SCREEN_BEGIN ([^\n]*)\n([\s\S]*?)^SCHOOLCALC_SCREEN_END$/gmu;
  for (const match of output.matchAll(expression)) {
    const rows = match[2].trimEnd().split('\n');
    if (rows.length !== 64 || rows.some((row) => [...row].length !== 128 || /[^.█]/u.test(row))) {
      throw new Error(`malformed LCD capture: ${match[1]}`);
    }
    const pixels = Buffer.alloc(LCD_BYTES);
    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 128; x += 1) {
        if ([...rows[y]][x] === '█') pixels[(y * 16) + (x >>> 3)] |= 0x80 >>> (x & 7);
      }
    }
    screens.push({ label: match[1], pixels });
  }
  return screens;
}

function formatScreen({ label, pixels }, mode) {
  const rendering = mode === 'pixels' ? renderTi86FramebufferAscii(pixels)
    : mode === 'text' ? renderTi86ScreenText(pixels)
      : mode === 'braille' ? renderTi86ScreenBraille(pixels)
        : renderTi86ScreenHybrid(pixels);
  return `SCHOOLCALC_SCREEN ${label}\n${rendering.trimEnd()}`;
}
function usage(message = null) {
  if (message) process.stderr.write(`[ti86:cli] ${message}\n`);
  process.stderr.write(`Usage: node _extensions/ti86-app/ti86.cli.mjs --bundle RELEASE [options]\n\n`
    + `  --load ASCHL              Wake and run a BASIC launcher in the exact release\n`
    + `  --transfer A,B            Transfer only named release variables (diagnostic)\n`
    + `  --keys DOWN,ENTER,F2      Comma/space-separated calculator keys\n`
    + `  --key F1                  Add one calculator key (repeatable)\n`
    + `  --text ABC                Enter alpha/numeric text (repeatable)\n`
    + `  --wait 60                 Wait 60 emulated frames (repeatable)\n`
    + `  --screens final|each      Dump just final LCD or after every action\n`
    + `  --screen hybrid           hybrid (default), text, braille, or exact pixels\n`
    + `  --output PATH             Save the transcript (useful for long emulator runs)\n`
    + `  --rom PATH                TI-86 ROM; defaults to the local user-owned dump\n`);
  process.exit(2);
}
