import { createHash } from 'node:crypto';
import { TI86_ASM_EXEC_RAM, TI86_VIDEO_RAM } from './ti86-program.mjs';
import { MAME_TI86_KEYS, normalizeMameTi86Key } from './ti86-mame.mjs';
import {
  TI86_MAME_INSTALL_MARKER,
  TI86_MAME_INSTALL_PROGRESS,
  TI86_MAME_INSTALL_STARTED,
} from './ti86-mame-provisioning.mjs';

export const TI86_FRAMEBUFFER_BYTES = 128 * 64 / 8;

/**
 * Render the exact 128×64 LCD framebuffer as terminal-safe text. Every
 * character maps to one LCD pixel: `.` is light, `█` is dark.
 */
export function renderTi86FramebufferAscii(pixels) {
  const bytes = Buffer.from(pixels ?? []);
  if (bytes.length !== TI86_FRAMEBUFFER_BYTES) {
    throw new Error(`TI-86 framebuffer must be ${TI86_FRAMEBUFFER_BYTES} bytes`);
  }
  const lines = [];
  for (let y = 0; y < 64; y += 1) {
    let line = '';
    for (let x = 0; x < 128; x += 1) {
      const byte = bytes[(y * 16) + (x >>> 3)];
      line += (byte & (0x80 >>> (x & 7))) ? '█' : '.';
    }
    lines.push(line);
  }
  return `${lines.join('\n')}\n`;
}

export function normalizeTi86MameScenario(input) {
  const id = String(input?.id ?? '');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new Error('MAME scenario id must be lowercase kebab-case');
  }
  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    throw new Error(`MAME scenario '${id}' requires at least one key step`);
  }
  // Scenario definitions are normalized once when read from YAML and again
  // by the Lua generators. Preserve the canonical camelCase shape on that
  // second pass; otherwise configured waits silently fall back to 30/18
  // frames and test keys race the real runtime validation work.
  const settleFrames = positiveInteger(input.settle_frames ?? input.settleFrames ?? 18, 'settle_frames');
  const steps = input.steps.map((step, index) => {
    const key = normalizeMameTi86Key(step?.key);
    const modifier = step?.modifier == null ? null : normalizeMameTi86Key(step.modifier);
    if (modifier === key) throw new Error(`MAME scenario '${id}' cannot chord ${key} with itself`);
    const capture = String(step.capture ?? `step-${index + 1}`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(capture)) {
      throw new Error(`MAME scenario '${id}' has an invalid capture id`);
    }
    return Object.freeze({
      key,
      modifier,
      modifierLeadFrames: modifier == null ? 0
        : positiveInteger(step.modifier_lead_frames ?? step.modifierLeadFrames ?? 12, 'modifier_lead_frames'),
      capture,
      holdFrames: positiveInteger(step.hold_frames ?? step.holdFrames ?? 4, 'hold_frames'),
      settleFrames: positiveInteger(step.settle_frames ?? step.settleFrames ?? settleFrames, 'settle_frames'),
      expectChanged: (step.expect_changed ?? step.expectChanged) !== false,
      expectDifferentFrom: (step.expect_different_from ?? step.expectDifferentFrom) == null
        ? null : String(step.expect_different_from ?? step.expectDifferentFrom),
      expectText: expectedTerms(step.expect_text ?? step.expectText, 'expect_text'),
      expectNotText: expectedTerms(step.expect_not_text ?? step.expectNotText, 'expect_not_text'),
      expectSymbols: expectedTerms(step.expect_symbols ?? step.expectSymbols, 'expect_symbols'),
      expectContrastWrite: step.expect_contrast_write === true || step.expectContrastWrite === true,
    });
  });
  if (new Set(steps.map(({ capture }) => capture)).size !== steps.length) {
    throw new Error(`MAME scenario '${id}' repeats a capture id`);
  }
  return Object.freeze({
    id,
    description: String(input.description ?? ''),
    bootSettleFrames: positiveInteger(input.boot_settle_frames ?? input.bootSettleFrames ?? 30, 'boot_settle_frames'),
    steps: Object.freeze(steps),
  });
}

export function createTi86MameScenarioScript({
  code,
  installers = [],
  scenario,
  origin = TI86_ASM_EXEC_RAM,
  timeoutFrames = 3600,
} = {}) {
  if (!Buffer.isBuffer(code) || code.length === 0) {
    throw new Error('MAME scenario requires exact non-empty shell bytes');
  }
  if (origin + code.length >= TI86_VIDEO_RAM) {
    throw new Error('MAME scenario shell overlaps TI-86 video RAM');
  }
  if (!Array.isArray(installers) || installers.some(({ code: installer }) => !Buffer.isBuffer(installer))) {
    throw new Error('MAME scenario installers must contain code Buffers');
  }
  const normalized = normalizeTi86MameScenario(scenario);
  const rows = [];
  for (let offset = 0; offset < code.length; offset += 24) {
    rows.push(`  ${[...code.subarray(offset, offset + 24)].join(', ')}`);
  }
  const stepRows = normalized.steps.map((step) => {
    const target = MAME_TI86_KEYS[step.key];
    const modifier = step.modifier == null ? null : MAME_TI86_KEYS[step.modifier];
    return `  { key=${luaString(step.key)}, capture=${luaString(step.capture)}, `
      + `port=${luaString(target.port)}, mask=0x${target.mask.toString(16)}, `
      + `hold=${step.holdFrames}, settle=${step.settleFrames}, `
      + `modifier_port=${modifier == null ? 'nil' : luaString(modifier.port)}, `
      + `modifier_mask=${modifier == null ? 'nil' : `0x${modifier.mask.toString(16)}`}, modifier_lead=${step.modifierLeadFrames} }`;
  });
  const installerRows = installers.map(({ fileName, code: installer }) => {
    const bytes = [];
    for (let offset = 0; offset < installer.length; offset += 24) {
      bytes.push(`      ${[...installer.subarray(offset, offset + 24)].join(', ')}`);
    }
    return `  { file=${luaString(fileName)}, code={\n${bytes.join(',\n')}\n  } }`;
  });

  return `-- Generated SchoolCalc exact-release MAME scenario.\n`
    + `local SCENARIO = ${luaString(normalized.id)}\n`
    + `local ORIGIN = 0x${hex4(origin)}\n`
    + `local VIDEO_RAM = 0x${hex4(TI86_VIDEO_RAM)}\n`
    + `local INSTALL_MARKER = 0x${hex4(TI86_MAME_INSTALL_MARKER)}\n`
    + `local INSTALL_STARTED = 0x${hex4(TI86_MAME_INSTALL_STARTED)}\n`
    + `local INSTALL_PROGRESS = 0x${hex4(TI86_MAME_INSTALL_PROGRESS)}\n`
    + `local FRAME_BYTES = ${TI86_FRAMEBUFFER_BYTES}\n`
    + `local BOOT_SETTLE = ${normalized.bootSettleFrames}\n`
    + `local TIMEOUT_FRAMES = ${positiveInteger(timeoutFrames, 'timeoutFrames')}\n`
    + `local code = {\n${rows.join(',\n')}\n}\n`
    + `local installers = {\n${installerRows.join(',\n')}\n}\n`
    + `local steps = {\n${stepRows.join(',\n')}\n}\n`
    + `local cpu = manager.machine.devices[':maincpu']\n`
    + `local screen = manager.machine.screens[':screen']\n`
    + `local memory = cpu and cpu.spaces['program'] or nil\n`
    + `local io = cpu and cpu.spaces['io'] or nil\n`
    + `local pc = cpu and (cpu.state['PC'] or cpu.state['rPC']) or nil\n`
    + `local ports = manager.machine.ioport.ports\n`
    + `local frame, phase, step_index, deadline, install_index = 0, 'boot-wait', 0, 0, 0\n`
    // The TI-86 contrast register is analog rather than framebuffer state.
    // Record writes so a headless scenario can prove a 2nd + arrow chord was
    // delivered to TI-OS without mistaking an unchanged bitmap for no effect.
    + `local contrast_writes = 0\n`
    + `if io then io:install_write_tap(0x02, 0x02, 'schoolcalc_contrast_trace', function(offset, data, mask)\n`
    + `  contrast_writes = contrast_writes + 1\n`
    + `  print(string.format('SCHOOLCALC_CONTRAST_WRITE id=%s frame=%d pc=%04X value=%02X', SCENARIO, frame, pc.value, data))\n`
    + `end) end\n`
    + `local active_field, modifier_field, pending_release_phase = nil, nil, nil\n`
    + `local function finish(kind, detail)\n`
    + `  if active_field then active_field:clear_value() end; if modifier_field then modifier_field:clear_value() end\n`
    + `  print('SCHOOLCALC_CONTRAST_SUMMARY id=' .. SCENARIO .. ' writes=' .. contrast_writes)\n`
    + `  print('SCHOOLCALC_SCENARIO_' .. kind .. ' id=' .. SCENARIO .. ' detail=' .. detail)\n`
    + `  manager.machine:exit()\n`
    + `end\n`
    + `local function capture(label)\n`
    + `  local out = {}\n`
    + `  for index=0,FRAME_BYTES-1 do out[#out+1]=string.format('%02X', memory:read_u8(VIDEO_RAM+index)) end\n`
    + `  print(string.format('SCHOOLCALC_FRAME id=%s capture=%s pc=%04X pixels=%s', SCENARIO, label, pc.value, table.concat(out)))\n`
    + `  print(string.format('SCHOOLCALC_CONTRAST_COUNT id=%s capture=%s writes=%d', SCENARIO, label, contrast_writes))\n`
    + `end\n`
    + `local function press_next()\n`
    + `  step_index = step_index + 1\n`
    + `  if step_index > #steps then capture('final'); finish('PASS', 'steps-complete'); return end\n`
    + `  local step=steps[step_index]; local port=ports[step.port]\n`
    + `  active_field=port and port:field(step.mask) or nil\n`
    + `  if not active_field then finish('FAIL', 'missing-key-' .. step.key); return end\n`
    + `  if step.modifier_port then local mport=ports[step.modifier_port]; modifier_field=mport and mport:field(step.modifier_mask) or nil; if not modifier_field then finish('FAIL', 'missing-modifier-' .. step.key); return end; modifier_field:set_value(1); deadline=frame+step.modifier_lead; pending_release_phase='release'; phase='modifier-lead' else active_field:set_value(1); deadline=frame+step.hold; phase='release' end\n`
    + `end\n`
    + `local function inject(bytes)\n`
    + `  for index,byte in ipairs(bytes) do memory:write_u8(ORIGIN+index-1, byte) end\n`
    // Assigning the state proxy directly from a frame callback looks valid,
    // but MAME can restore the CPU's paused debugger context on the next
    // quantum. Use the same debugger-mediated PC handoff as the exact-input
    // gate, so direct injection genuinely executes the packaged bytes.
    + `  manager.machine.debugger.visible_cpu=cpu\n`
    + `  manager.machine.debugger:command(string.format('do pc = %X', ORIGIN))\n`
    + `  manager.machine.debugger:command('g')\n`
    + `end\n`
    + `local function start_next_install()\n`
    + `  install_index=install_index+1\n`
    + `  if install_index>#installers then\n`
    + `    inject(code); deadline=frame+BOOT_SETTLE; phase='shell-settle'; return\n`
    + `  end\n`
    + `  memory:write_u8(INSTALL_MARKER, 0)\n`
    + `  memory:write_u8(INSTALL_STARTED, 0)\n`
    + `  memory:write_u8(INSTALL_PROGRESS, 0)\n`
    + `  local installer=installers[install_index]\n`
    + `  inject(installer.code); deadline=frame+900; phase='install-wait'\n`
    + `  print(string.format('SCHOOLCALC_INSTALL id=%s file=%s index=%d', SCENARIO, installer.file, install_index))\n`
    + `end\n`
    + `local function on_frame()\n`
    + `  frame=frame+1\n`
    + `  if not cpu or not memory or not pc then finish('FAIL', 'cpu-interface'); return end\n`
    + `  if frame >= TIMEOUT_FRAMES then finish('FAIL', string.format('timeout-pc-%04X', pc.value)); return end\n`
    + `  if frame == 40 then local f=ports[':ON'] and ports[':ON']:field(0x1); if f then f:set_value(1) end\n`
    + `  elseif frame == 52 then local f=ports[':ON'] and ports[':ON']:field(0x1); if f then f:clear_value() end end\n`
    + `  if phase == 'boot-wait' and frame == 139 then print(string.format('SCHOOLCALC_MAP p5=%02X p6=%02X c45F3=%02X c472F=%02X', io:read_u8(5), io:read_u8(6), memory:read_u8(0x45F3), memory:read_u8(0x472F))) end\n`
    + `  if phase == 'boot-wait' and frame >= 140 then\n`
    + `    start_next_install()\n`
    + `  elseif phase == 'install-wait' and memory:read_u8(INSTALL_MARKER) == 0xA5 then\n`
    + `    deadline=frame+24; phase='install-settle'\n`
    + `  elseif phase == 'install-wait' and frame >= deadline then\n`
    + `    local installer=installers[install_index]; capture('install-error'); finish('FAIL', string.format('install-timeout-%s-pc-%04X-start-%02X-stage-%02X-mark-%02X', installer.file, pc.value, memory:read_u8(INSTALL_STARTED), memory:read_u8(INSTALL_PROGRESS), memory:read_u8(INSTALL_MARKER))); return\n`
    + `  elseif phase == 'install-settle' and frame >= deadline then\n`
    + `    start_next_install()\n`
    + `  elseif phase == 'shell-settle' and frame >= deadline then capture('boot'); press_next()\n`
    + `  elseif phase == 'modifier-lead' and frame >= deadline then active_field:set_value(1); local step=steps[step_index]; deadline=frame+step.hold; phase=pending_release_phase\n`
    + `  elseif phase == 'release' and frame >= deadline then\n`
    + `    active_field:clear_value(); active_field=nil; if modifier_field then modifier_field:clear_value(); modifier_field=nil end\n`
    + `    local step=steps[step_index]; deadline=frame+step.settle; phase='settle'\n`
    + `  elseif phase == 'settle' and frame >= deadline then capture(steps[step_index].capture); press_next() end\n`
    + `end\n`
    + `emu.register_frame_done(on_frame, 'schoolcalc_scenario')\n`;
}

/**
 * Run an exact release through MAME's virtual TI-Graph Link and launch its
 * installed BASIC entry point through TI-OS. This deliberately never jumps
 * directly into $D748: TI-OS owns the ROM-bank context for an Asm( program,
 * just as it does on physical TI-86 hardware.
 */
export function createTi86MameGraphLinkScenarioScript({
  code,
  scenario,
  readyFile,
  launchProgram = 'ASCHL',
  programNames = [launchProgram],
  timeoutFrames = 3600,
} = {}) {
  if (!Buffer.isBuffer(code) || code.length === 0) {
    throw new Error('MAME Graph Link scenario requires exact non-empty shell bytes');
  }
  if (!readyFile) throw new Error('MAME Graph Link scenario requires a release-ready file');
  const normalized = normalizeTi86MameScenario(scenario);
  const requestedLaunch = String(launchProgram).trim().toUpperCase();
  const visiblePrograms = [...new Set((programNames ?? []).map((name) => String(name).trim().toUpperCase()))]
    .sort();
  if (!/^[A-Z][A-Z0-9]{0,7}$/.test(requestedLaunch) || !visiblePrograms.includes(requestedLaunch)) {
    throw new Error('MAME Graph Link scenario launch program is not installed');
  }
  const launchIndex = visiblePrograms.indexOf(requestedLaunch);
  if (launchIndex > 4) {
    throw new Error(`MAME Graph Link scenario '${requestedLaunch}' is beyond the first PROGRAM page`);
  }
  const stepRows = normalized.steps.map((step) => {
    const target = MAME_TI86_KEYS[step.key];
    const modifier = step.modifier == null ? null : MAME_TI86_KEYS[step.modifier];
    return `  { key=${luaString(step.key)}, capture=${luaString(step.capture)}, `
      + `port=${luaString(target.port)}, mask=0x${target.mask.toString(16)}, `
      + `hold=${step.holdFrames}, settle=${step.settleFrames}, `
      + `modifier_port=${modifier == null ? 'nil' : luaString(modifier.port)}, `
      + `modifier_mask=${modifier == null ? 'nil' : `0x${modifier.mask.toString(16)}`}, modifier_lead=${step.modifierLeadFrames} }`;
  });

  return `-- Generated SchoolCalc Graph Link acceptance scenario.\n`
    + `local SCENARIO = ${luaString(normalized.id)}\n`
    + `local READY_FILE = ${luaString(String(readyFile))}\n`
    + `local VIDEO_RAM = 0x${hex4(TI86_VIDEO_RAM)}\n`
    + `local FRAME_BYTES = ${TI86_FRAMEBUFFER_BYTES}\n`
    + `local BOOT_SETTLE = ${normalized.bootSettleFrames}\n`
    + `local TIMEOUT_FRAMES = ${positiveInteger(timeoutFrames, 'timeoutFrames')}\n`
    + `local steps = {\n${stepRows.join(',\n')}\n}\n`
    + `local launch = {\n`
    // The link transfer can leave the TI-86 asleep while its LCD retains the
    // transfer screen. Wake it again before dismissing that screen; ordinary
    // keys are otherwise ignored by TI-OS after the completed link session.
    + `  { key='ON', port=':ON', mask=0x1, hold=12, settle=36 },\n`
    // TI-OS displays its transfer-complete acknowledgement after the virtual
    // Graph Link session closes. Dismiss it before opening the Program menu;
    // otherwise the first two launch keys are consumed by TI-OS and every
    // subsequent test is accidentally run against the command screen.
    + `  { key='EXIT', port=':BIT6', mask=0x40, hold=12, settle=36 },\n`
    + `  { key='PRGM', port=':BIT6', mask=0x8, hold=12, settle=36 },\n`
    // TI-86's PROGRAM screen first uses F1 to open NAMES. Its first page
    // maps F1–F5 to the alphabetically sorted installed programs. Selecting
    // a name returns its TI-OS command; ENTER then runs that exact program.
    + `  { key='F1', port=':BIT4', mask=0x40, hold=12, settle=24 },\n`
    + `  { key='F${launchIndex + 1}', port='${MAME_TI86_KEYS[`F${launchIndex + 1}`].port}', mask=0x${MAME_TI86_KEYS[`F${launchIndex + 1}`].mask.toString(16)}, hold=12, settle=24 },\n`
    + `  { key='ENTER', port=':BIT0', mask=0x2, hold=12, settle=BOOT_SETTLE }\n`
    + `}\n`
    + `local cpu = manager.machine.devices[':maincpu']\n`
    + `local memory = cpu and cpu.spaces['program'] or nil\n`
    + `local io = cpu and cpu.spaces['io'] or nil\n`
    + `local pc = cpu and (cpu.state['PC'] or cpu.state['rPC']) or nil\n`
    + `local ports = manager.machine.ioport.ports\n`
    + `local frame, phase, step_index, launch_index, deadline = 0, 'wait-release', 0, 0, 0\n`
    + `local contrast_writes = 0\n`
    + `if io then io:install_write_tap(0x02, 0x02, 'schoolcalc_graph_link_contrast_trace', function(offset, data, mask)\n`
    + `  contrast_writes = contrast_writes + 1\n`
    + `  print(string.format('SCHOOLCALC_CONTRAST_WRITE id=%s frame=%d pc=%04X value=%02X', SCENARIO, frame, pc.value, data))\n`
    + `end) end\n`
    + `local active_field, modifier_field, pending_release_phase = nil, nil, nil\n`
    + `local function finish(kind, detail)\n`
    + `  if active_field then active_field:clear_value() end; if modifier_field then modifier_field:clear_value() end\n`
    + `  print('SCHOOLCALC_CONTRAST_SUMMARY id=' .. SCENARIO .. ' writes=' .. contrast_writes)\n`
    + `  print('SCHOOLCALC_SCENARIO_' .. kind .. ' id=' .. SCENARIO .. ' detail=' .. detail)\n`
    + `  manager.machine:exit()\n`
    + `end\n`
    // MAME deliberately exposes a restricted Lua standard library; `io.open`
    // is not available in headless builds. Use the emulator-owned file object
    // for the host-to-script readiness sentinel instead.
    + `local function ready() local f=emu.file('r'); local err=f:open(READY_FILE); if err then return false end; f:close(); return true end\n`
    + `local function capture(label)\n`
    + `  local out = {}\n`
    + `  for index=0,FRAME_BYTES-1 do out[#out+1]=string.format('%02X', memory:read_u8(VIDEO_RAM+index)) end\n`
    + `  print(string.format('SCHOOLCALC_FRAME id=%s capture=%s pc=%04X pixels=%s', SCENARIO, label, pc.value, table.concat(out)))\n`
    + `  print(string.format('SCHOOLCALC_CONTRAST_COUNT id=%s capture=%s writes=%d', SCENARIO, label, contrast_writes))\n`
    + `end\n`
    + `local function press(target, next_phase)\n`
    + `  local port=ports[target.port]; active_field=port and port:field(target.mask) or nil\n`
    + `  if not active_field then finish('FAIL', 'missing-key-' .. target.key); return end\n`
    + `  if target.modifier_port then local mport=ports[target.modifier_port]; modifier_field=mport and mport:field(target.modifier_mask) or nil; if not modifier_field then finish('FAIL', 'missing-modifier-' .. target.key); return end; modifier_field:set_value(1); deadline=frame+target.modifier_lead; pending_release_phase=next_phase; phase='modifier-lead' else active_field:set_value(1); deadline=frame+target.hold; phase=next_phase end\n`
    + `end\n`
    + `local function press_next()\n`
    + `  step_index=step_index+1\n`
    + `  if step_index>#steps then capture('final'); finish('PASS', 'steps-complete'); return end\n`
    + `  press(steps[step_index], 'release-step')\n`
    + `end\n`
    + `local function press_launch()\n`
    + `  launch_index=launch_index+1\n`
    + `  if launch_index>#launch then capture('boot'); press_next(); return end\n`
    + `  press(launch[launch_index], 'release-launch')\n`
    + `end\n`
    + `local function on_frame()\n`
    + `  frame=frame+1\n`
    + `  if not cpu or not memory or not pc then finish('FAIL', 'cpu-interface'); return end\n`
    + `  if frame>=TIMEOUT_FRAMES then finish('FAIL', string.format('timeout-pc-%04X-phase-%s', pc.value, phase)); return end\n`
    + `  if frame % 300 == 0 then print(string.format('SCHOOLCALC_HEARTBEAT id=%s frame=%d phase=%s pc=%04X', SCENARIO, frame, phase, pc.value)) end\n`
    + `  if frame==40 then local f=ports[':ON'] and ports[':ON']:field(0x1); if f then f:set_value(1) end\n`
    + `  elseif frame==52 then local f=ports[':ON'] and ports[':ON']:field(0x1); if f then f:clear_value() end end\n`
    + `  if phase=='wait-release' and ready() then print('SCHOOLCALC_RELEASE_READY id=' .. SCENARIO); press_launch()\n`
    + `  elseif phase=='modifier-lead' and frame>=deadline then active_field:set_value(1); local target = (pending_release_phase=='release-launch') and launch[launch_index] or steps[step_index]; deadline=frame+target.hold; phase=pending_release_phase\n`
    + `  elseif (phase=='release-launch' or phase=='release-step') and frame>=deadline then\n`
    + `    active_field:clear_value(); active_field=nil; if modifier_field then modifier_field:clear_value(); modifier_field=nil end\n`
    + `    if phase=='release-launch' then local target=launch[launch_index]; deadline=frame+target.settle; phase='settle-launch'\n`
    + `    else local target=steps[step_index]; deadline=frame+target.settle; phase='settle-step' end\n`
    + `  elseif phase=='settle-launch' and frame>=deadline then\n`
    + `    capture('launch-' .. launch_index)\n`
    + `    press_launch()\n`
    + `  elseif phase=='settle-step' and frame>=deadline then capture(steps[step_index].capture); press_next() end\n`
    + `end\n`
    + `emu.register_frame_done(on_frame, 'schoolcalc_graph_link_scenario')\n`;
}

export function parseTi86MameScenarioOutput(output, scenario, { requireSchoolCalcBoot = false } = {}) {
  const normalized = normalizeTi86MameScenario(scenario);
  const frames = new Map();
  const contrastWrites = new Map();
  for (const line of String(output ?? '').split(/\r?\n/)) {
    const contrast = line.match(/^SCHOOLCALC_CONTRAST_COUNT id=([^ ]+) capture=([^ ]+) writes=(\d+)$/);
    if (contrast && contrast[1] === normalized.id) {
      contrastWrites.set(contrast[2], Number.parseInt(contrast[3], 10));
      continue;
    }
    const match = line.match(/^SCHOOLCALC_FRAME id=([^ ]+) capture=([^ ]+) pc=([0-9A-F]{4}) pixels=([0-9A-F]+)$/);
    if (!match || match[1] !== normalized.id) continue;
    const pixels = Buffer.from(match[4], 'hex');
    if (pixels.length !== TI86_FRAMEBUFFER_BYTES) throw new Error('MAME emitted a truncated framebuffer');
    frames.set(match[2], Object.freeze({
      capture: match[2], pc: Number.parseInt(match[3], 16), pixels,
      sha256: createHash('sha256').update(pixels).digest('hex'),
    }));
  }
  if (!String(output ?? '').includes(`SCHOOLCALC_SCENARIO_PASS id=${normalized.id} `)) {
    const failure = String(output ?? '').split(/\r?\n/)
      .find((line) => line.includes(`SCHOOLCALC_SCENARIO_FAIL id=${normalized.id} `));
    throw new Error(failure ?? `MAME scenario '${normalized.id}' did not complete`);
  }
  const boot = frames.get('boot');
  if (!boot) throw new Error(`MAME scenario '${normalized.id}' has no boot framebuffer`);
  // The SchoolCalc profile view owns the inverse eight-pixel header.  A
  // program-menu command line can also execute in the calculator RAM window,
  // so PC range alone is not proof that TI-OS reached SchoolCalc.
  if (requireSchoolCalcBoot && !hasSchoolCalcHeader(boot.pixels)) {
    throw new Error(`MAME scenario '${normalized.id}' never reached the SchoolCalc shell`);
  }
  let prior = boot;
  // Startup itself initializes the analog port. A contrast assertion must
  // therefore compare against the boot capture, not zero, or it can mistake
  // the OS's initial write for the app chord.
  let priorContrastWrites = contrastWrites.get('boot') ?? 0;
  for (const step of normalized.steps) {
    const current = frames.get(step.capture);
    if (!current) throw new Error(`MAME scenario '${normalized.id}' missed '${step.capture}'`);
    if (step.expectChanged && current.sha256 === prior.sha256) {
      throw new Error(`MAME scenario '${normalized.id}' '${step.capture}' after ${step.key} left the screen unchanged`);
    }
    if (step.expectDifferentFrom) {
      const other = frames.get(step.expectDifferentFrom);
      if (!other) throw new Error(`unknown comparison capture '${step.expectDifferentFrom}'`);
      if (current.sha256 === other.sha256) {
        throw new Error(`MAME scenario '${normalized.id}' '${step.capture}' bounced to '${step.expectDifferentFrom}'`);
      }
    }
    const currentContrastWrites = contrastWrites.get(step.capture);
    if (step.expectContrastWrite && (!Number.isInteger(currentContrastWrites)
      || currentContrastWrites <= priorContrastWrites)) {
      throw new Error(`MAME scenario '${normalized.id}' '${step.capture}' expected a new LCD contrast-port write`);
    }
    if (Number.isInteger(currentContrastWrites)) priorContrastWrites = currentContrastWrites;
    prior = current;
  }
  return Object.freeze({ scenario: normalized, frames });
}

// SchoolCalc's entry profile has the shared inverse header: eight rows of
// nearly-solid foreground pixels. TI-OS's command/PROGRAM screens do not.
// This guards against tests accidentally driving TI-OS after a link transfer.
export function hasSchoolCalcHeader(pixels) {
  const bytes = Buffer.from(pixels ?? []);
  if (bytes.length !== TI86_FRAMEBUFFER_BYTES) return false;
  let setBits = 0;
  for (let index = 0; index < 16 * 8; index += 1) {
    let value = bytes[index];
    while (value) {
      value &= value - 1;
      setBits += 1;
    }
  }
  return setBits >= 700;
}

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function expectedTerms(value, name) {
  if (value == null) return Object.freeze([]);
  const terms = (Array.isArray(value) ? value : [value]).map((term) => String(term));
  if (terms.some((term) => term.length === 0)) throw new Error(`${name} must not contain an empty term`);
  return Object.freeze(terms);
}

function luaString(value) { return `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`; }
function hex4(value) { return value.toString(16).toUpperCase().padStart(4, '0'); }
