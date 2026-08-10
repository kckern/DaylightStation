import { createHash } from 'node:crypto';
import { TI86_ASM_EXEC_RAM, TI86_VIDEO_RAM } from './ti86-program.mjs';
import { TI86_ROM } from './ti86-os-vars.mjs';

export const TI86_ROM_BYTES = 0x40000;

export const MAME_TI86_ROMS = Object.freeze([
  Object.freeze({
    bios: 'v12', version: '1.2', filename: 'ti86v12.bin',
    crc32: 'bdf16105', sha1: 'e40b22421c31bf0af104518b748ae79cd21d9c57',
  }),
  Object.freeze({
    bios: 'v13', version: '1.3', filename: 'ti86v13.bin',
    crc32: '073ef70f', sha1: '5702d4bb835bdcbfa8075ffd620fca0eaf3a1592',
  }),
  Object.freeze({
    bios: 'v14', version: '1.4', filename: 'ti86v14.bin',
    crc32: 'fe6e2986', sha1: '23e0fb9a1763d5b9a7b0e593f09c2ff30c760866',
  }),
  Object.freeze({
    bios: 'v15', version: '1.5', filename: 'ti86v15.bin', knownBadDump: true,
    crc32: 'e6e10546', sha1: '5ca63fdfc965ae3fb8e0695263cf9da41f6ecb90',
  }),
  Object.freeze({
    bios: 'v16', version: '1.6', filename: 'ti86v16.bin',
    crc32: '37e02acc', sha1: 'b5ad204885e5dde23a22f18f8d5eaffca69d638d',
  }),
]);

export const MAME_TI86_KEYS = Object.freeze({
  DOWN: Object.freeze({ port: ':BIT0', mask: 0x01 }),
  ENTER: Object.freeze({ port: ':BIT0', mask: 0x02 }),
  '0': Object.freeze({ port: ':BIT0', mask: 0x10 }),
  F5: Object.freeze({ port: ':BIT0', mask: 0x40 }),
  LEFT: Object.freeze({ port: ':BIT1', mask: 0x01 }),
  '1': Object.freeze({ port: ':BIT1', mask: 0x10 }),
  '2': Object.freeze({ port: ':BIT1', mask: 0x08 }),
  '3': Object.freeze({ port: ':BIT1', mask: 0x04 }),
  F4: Object.freeze({ port: ':BIT1', mask: 0x40 }),
  RIGHT: Object.freeze({ port: ':BIT2', mask: 0x01 }),
  '4': Object.freeze({ port: ':BIT2', mask: 0x10 }),
  '5': Object.freeze({ port: ':BIT2', mask: 0x08 }),
  '6': Object.freeze({ port: ':BIT2', mask: 0x04 }),
  F3: Object.freeze({ port: ':BIT2', mask: 0x40 }),
  UP: Object.freeze({ port: ':BIT3', mask: 0x01 }),
  '7': Object.freeze({ port: ':BIT3', mask: 0x10 }),
  '8': Object.freeze({ port: ':BIT3', mask: 0x08 }),
  '9': Object.freeze({ port: ':BIT3', mask: 0x04 }),
  F2: Object.freeze({ port: ':BIT3', mask: 0x40 }),
  F1: Object.freeze({ port: ':BIT4', mask: 0x40 }),
  SECOND: Object.freeze({ port: ':BIT5', mask: 0x40 }),
  PRGM: Object.freeze({ port: ':BIT6', mask: 0x08 }),
  CLEAR: Object.freeze({ port: ':BIT6', mask: 0x02 }),
  EXIT: Object.freeze({ port: ':BIT6', mask: 0x40 }),
  ON: Object.freeze({ port: ':ON', mask: 0x01 }),
});

export function sha1(bytes) {
  return createHash('sha1').update(bytes).digest('hex');
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function identifyTi86Rom({ byteLength, digest }) {
  if (byteLength !== TI86_ROM_BYTES) {
    throw new Error(`TI-86 ROM must be exactly ${TI86_ROM_BYTES} bytes; got ${byteLength}`);
  }
  const normalizedDigest = String(digest ?? '').toLowerCase();
  const descriptor = MAME_TI86_ROMS.find((candidate) => candidate.sha1 === normalizedDigest);
  if (!descriptor) {
    throw new Error(`unrecognized TI-86 ROM SHA-1 ${normalizedDigest || '<missing>'}`);
  }
  return descriptor;
}

export function inspectTi86Rom(rom) {
  if (!Buffer.isBuffer(rom)) throw new Error('TI-86 ROM must be a Buffer');
  return identifyTi86Rom({ byteLength: rom.length, digest: sha1(rom) });
}

export function normalizeMameTi86Key(key) {
  const normalized = String(key ?? '').trim().toUpperCase();
  if (!MAME_TI86_KEYS[normalized]) {
    throw new Error(`unsupported MAME TI-86 key '${key}'`);
  }
  return normalized;
}

/**
 * Generate a MAME autoboot script for one fresh, deterministic key run.
 *
 * The exact packaged code bytes are copied to the TI-86 Asm( execution
 * address. A debugger breakpoint at TI-OS _JforceCmdNoChar writes one marker
 * byte after the code and immediately resumes. The frame callback observes
 * the marker, prints a machine-readable pass line, and exits MAME.
 */
export function createTi86MameInputScript({
  code,
  key,
  origin = TI86_ASM_EXEC_RAM,
  injectFrame = 120,
  // A complete SchoolCalc surface can spend several frames drawing the first
  // 128×64 view after it is injected. Do not press the acceptance key during
  // that render: doing so would only prove that the launch-key release fence
  // discards an early key. The probe has an ample quiet interval before this
  // point and MAME runs it unthrottled.
  pressFrame = 300,
  releaseFrame = 324,
  timeoutFrame = 600,
} = {}) {
  if (!Buffer.isBuffer(code) || code.length === 0) {
    throw new Error('MAME input gate requires non-empty Z80 code bytes');
  }
  if (!Number.isInteger(origin) || origin < 0 || origin > 0xFFFF) {
    throw new Error('invalid TI-86 injection origin');
  }
  const marker = origin + code.length + 8;
  if (marker >= TI86_VIDEO_RAM) {
    throw new Error('MAME marker would overlap TI-86 video RAM');
  }
  if (![injectFrame, pressFrame, releaseFrame, timeoutFrame]
    .every((frame) => Number.isInteger(frame) && frame > 0)
      || !(injectFrame < pressFrame && pressFrame < releaseFrame && releaseFrame < timeoutFrame)) {
    throw new Error('invalid MAME frame schedule');
  }

  const normalizedKey = normalizeMameTi86Key(key);
  const target = MAME_TI86_KEYS[normalizedKey];
  const byteRows = [];
  for (let offset = 0; offset < code.length; offset += 24) {
    byteRows.push(`  ${[...code.subarray(offset, offset + 24)].join(', ')}`);
  }

  return `-- Generated SchoolCalc exact-binary MAME input gate.\n`
    + `local TEST_KEY = ${luaString(normalizedKey)}\n`
    + `local ORIGIN = 0x${hex4(origin)}\n`
    + `local MARKER = 0x${hex4(marker)}\n`
    + `local FORCE_EXIT = 0x${hex4(TI86_ROM.forceCommandNoCharacter)}\n`
    + `local INJECT_FRAME = ${injectFrame}\n`
    + `local PRESS_FRAME = ${pressFrame}\n`
    + `local RELEASE_FRAME = ${releaseFrame}\n`
    + `local TIMEOUT_FRAME = ${timeoutFrame}\n`
    + `local code = {\n${byteRows.join(',\n')}\n}\n`
    + `local cpu = manager.machine.devices[':maincpu']\n`
    + `local ports = manager.machine.ioport.ports\n`
    + `local port = ports[${luaString(target.port)}]\n`
    + `local field = port and port:field(0x${target.mask.toString(16)}) or nil\n`
    + `local memory = cpu and cpu.spaces['program'] or nil\n`
    + `local pc = cpu and (cpu.state['PC'] or cpu.state['rPC']) or nil\n`
    + `local frame = 0\n`
    + `local injected = false\n`
    + `local finished = false\n`
    + `local function finish(kind, detail)\n`
    + `  if finished then return end\n`
    + `  finished = true\n`
    + `  if field then field:clear_value() end\n`
    + `  print('SCHOOLCALC_MAME_' .. kind .. ' key=' .. TEST_KEY .. ' detail=' .. detail)\n`
    + `  manager.machine:exit()\n`
    + `end\n`
    + `if not cpu or not cpu.debug then finish('FAIL', 'debugger-unavailable') return end\n`
    + `if not memory or not pc then finish('FAIL', 'cpu-interface-unavailable') return end\n`
    + `if not field then finish('FAIL', 'key-field-unavailable') return end\n`
    + `memory:write_u8(MARKER, 0)\n`
    + `cpu.debug:bpset(FORCE_EXIT, nil, string.format('b@%X = 1 ; g', MARKER))\n`
    + `local function on_frame()\n`
    + `  frame = frame + 1\n`
    + `  if frame == 5 then\n`
    + `    local wake = ports[':ON'] and ports[':ON']:field(0x1) or nil\n`
    + `    if wake then wake:set_value(1) end\n`
    + `  elseif frame == 8 then\n`
    + `    local wake = ports[':ON'] and ports[':ON']:field(0x1) or nil\n`
    + `    if wake then wake:clear_value() end\n`
    + `  elseif frame == 24 then\n`
    + `    local clear = ports[':BIT6'] and ports[':BIT6']:field(0x2) or nil\n`
    + `    if clear then clear:set_value(1) end\n`
    + `  elseif frame == 27 then\n`
    + `    local clear = ports[':BIT6'] and ports[':BIT6']:field(0x2) or nil\n`
    + `    if clear then clear:clear_value() end\n`
    + `  elseif frame == 42 then\n`
    + `    local enter = ports[':BIT0'] and ports[':BIT0']:field(0x2) or nil\n`
    + `    if enter then enter:set_value(1) end\n`
    + `  elseif frame == 45 then\n`
    + `    local enter = ports[':BIT0'] and ports[':BIT0']:field(0x2) or nil\n`
    + `    if enter then enter:clear_value() end\n`
    + `  elseif frame == INJECT_FRAME then\n`
    + `    for index, byte in ipairs(code) do memory:write_u8(ORIGIN + index - 1, byte) end\n`
    + `    memory:write_u8(MARKER, 0)\n`
    + `    manager.machine.debugger.visible_cpu = cpu\n`
    + `    manager.machine.debugger:command(string.format('do pc = %X', ORIGIN))\n`
    + `    manager.machine.debugger:command('g')\n`
    + `    injected = true\n`
    + `    print(string.format('SCHOOLCALC_MAME_INJECT key=%s bytes=%d origin=%04X', TEST_KEY, #code, ORIGIN))\n`
    + `  elseif frame == PRESS_FRAME then\n`
    + `    field:set_value(1)\n`
    + `  elseif frame == RELEASE_FRAME then\n`
    + `    field:clear_value()\n`
    + `  end\n`
    + `  if injected and memory:read_u8(MARKER) == 1 then\n`
    + `    finish('PASS', 'force-command-no-character')\n`
    + `  elseif frame >= TIMEOUT_FRAME then\n`
    + `    finish('FAIL', string.format('timeout-pc-%04X', pc.value))\n`
    + `  end\n`
    + `end\n`
    + `emu.register_frame_done(on_frame, 'schoolcalc_exact_binary_input_gate')\n`
    + `manager.machine.debugger.visible_cpu = cpu\n`
    + `manager.machine.debugger:command('g')\n`;
}

export function createTi86MameArguments({
  bios,
  romPath,
  scriptPath,
  debugScriptPath,
  workPath,
} = {}) {
  if (!MAME_TI86_ROMS.some((descriptor) => descriptor.bios === bios)) {
    throw new Error(`unsupported TI-86 MAME BIOS '${bios}'`);
  }
  for (const [name, value] of Object.entries({ romPath, scriptPath, debugScriptPath, workPath })) {
    if (!value) throw new Error(`missing MAME ${name}`);
  }
  return [
    'ti86',
    '-bios', bios,
    '-rompath', romPath,
    '-autoboot_delay', '0',
    '-autoboot_script', scriptPath,
    '-debug',
    '-debugger', 'none',
    '-debugscript', debugScriptPath,
    '-video', 'none',
    '-sound', 'none',
    '-nothrottle',
    '-skip_gameinfo',
    '-seconds_to_run', '15',
    '-nvram_directory', `${workPath}/nvram`,
    '-cfg_directory', `${workPath}/cfg`,
    '-input_directory', `${workPath}/input`,
    '-state_directory', `${workPath}/state`,
    '-snapshot_directory', `${workPath}/snap`,
  ];
}

function luaString(value) {
  return `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

function hex4(value) {
  return value.toString(16).toUpperCase().padStart(4, '0');
}
