#!/usr/bin/env node
/**
 * Runs the exact TI-86 SCSYNC release in TilEm's TI-86 core. A production
 * TiLinkTransport and relay session share TilEm's virtual BlackLink, while
 * a MAME virtual Graph Link provisioning run seeds real TI String variables.
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyTi86Program } from '../../../ti86-app/tools/lib/ti86-program.mjs';
import { createTi86StringFile } from '../../../ti86-app/tools/lib/ti86-string-file.mjs';
import { createTi86MameArguments, inspectTi86Rom, sha256 } from '../../../ti86-app/tools/lib/ti86-mame.mjs';
import { hasSchoolCalcHeader } from '../../../ti86-app/tools/lib/ti86-mame-scenario.mjs';
import {
  Ti86SchoolCalcCodec,
  decodeTi86Acknowledgements,
  decodeTi86Envelope,
  decodeTi86InteractionRequest,
  decodeTi86InteractionResponse,
  decodeTi86ProgressProjection,
  decodeTi86ResultQueueRecord,
  decodeTi86SyncManifest,
  encodeTi86DeliveryRequests,
  encodeTi86DeviceInfo,
  encodeTi86InteractionRequest,
  encodeTi86ResultQueue,
  encodeTi86ResultRecord,
} from '../../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIRMWARE = path.resolve(HERE, '..');
const EXTENSION = path.resolve(FIRMWARE, '..');
const TI86_APP = path.resolve(EXTENSION, '..', 'ti86-app');
const TILEM_DEBIAN_REVISION = '74bf2f4ef12bf0ac95e1af3666343528a5381f18';

if (isMainModule()) {
  try {
    const result = await run(parseArguments(process.argv.slice(2)));
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    process.stderr.write('[ticalc:tilem] ' + (error.stack ?? error.message) + '\n');
    process.exitCode = 1;
  }
}

async function run(options) {
  if (!options.rom) throw new Error('an owned TI-86 ROM is required; set TI86_ROM or pass --rom');
  if (!options.tilemSource) throw new Error('TilEm source is required; set TILEM_SOURCE or pass --tilem-source');
  if (!existsSync(options.rom)) throw new Error('TI-86 ROM is missing: ' + options.rom);
  if (!existsSync(options.tilemSource)) {
    throw new Error('TilEm 2 source is required at ' + options.tilemSource
      + '; set TILEM_SOURCE or pass --tilem-source');
  }
  verifyTilemSource(options.tilemSource);
  const syncProgram = readFileSync(options.syncProgram);
  const sync = verifyTi86Program(syncProgram, { expectedName: 'SCSYNC' });
  const baseRelease = loadMameRelease(options.bundle);
  const descriptor = inspectTi86Rom(readFileSync(options.rom));
  const runPath = mkdtempSync(path.join(tmpdir(), 'ticalc-tilem-wire-'));
  try {
    const release = prepareMameRelease(baseRelease, options.syncProgram, runPath);
    const semanticRelay = runSemanticRelay();
    const fixture = createSemanticFixture(runPath);
    const programImage = path.join(runPath, 'SCSYNC.code.bin');
    writeFileSync(programImage, sync.code);
    const checkpoint = await provisionMameRamImage({
      options, descriptor, fixture, release, runPath, foregroundPrefix: sync.code.subarray(0, 32),
    });
    const binary = buildHarness(runPath, options);
    const completeFile = path.join(runPath, 'relay-complete');
    const result = await runHarness(binary, [
      '--rom', options.rom,
      '--fixture-dir', fixture.directory,
      '--ram-image', checkpoint.ramImage,
      '--execution-image', checkpoint.executionImage,
      '--cpu-context', checkpoint.cpuContext,
      '--program-image', programImage,
      '--complete-file', completeFile,
    ], options.timeoutMs);
    if (result.code !== 0 || !result.output.includes('TICALC_TILEM_RELAY_PASS')) {
      throw new Error('TilEm virtual relay failed: ' + tail(result.output));
    }
    const complete = parseKeyValueFile(completeFile);
    for (const [key, expected] of Object.entries({
      ok: 'true',
      state: 'raw-foreground-frames',
      phaseAcks: '2',
    })) {
      if (complete[key] !== expected) {
        throw new Error(`unexpected ${key} in TilEm completion report: ${JSON.stringify(complete)}`);
      }
    }
    for (const key of ['calculatorEvents', 'relayEvents', 'keyboardTransitions']) {
      if (Number(complete[key]) <= 0) {
        throw new Error(`TilEm completion report has no ${key}: ${JSON.stringify(complete)}`);
      }
    }
    return {
      schema: 'school.calc.ticalc-relay.tilem-wire/v1',
      emulator: { name: 'TilEm 2', model: 'TI-86', rom: descriptor.version },
      provisioning: {
        emulator: 'MAME TI-86', transport: 'virtual Graph Link',
        releaseId: release.manifest.releaseId,
        transferred: ['complete release bundle', 'DSID', 'DSINFO', 'DSINST', 'DSQ', 'DSREQ', 'DSTREQ'],
      },
      foregroundProgram: { name: sync.name, codeBytes: sync.code.length },
      keyboard: {
        keys: ['ON', 'ENTER', 'CLEAR'], wokeTiOs: true,
        matrixPressReleaseVerified: true, transitions: Number(complete.keyboardTransitions),
      },
      relay: {
        semanticSession: semanticRelay,
        rawForegroundState: complete.state,
        phaseAcks: Number(complete.phaseAcks),
        inputs: ['DSID', 'DSINFO', 'DSINST', 'DSQ', 'DSREQ', 'DSTREQ'],
        writes: ['DSUSRNEW', 'DSPRGNEW', 'DSTNEW', 'DSCATNEW', 'DP7L3CWY', 'DSACKNEW', 'DSSYNC'],
        calculatorEvents: Number(complete.calculatorEvents),
        relayEvents: Number(complete.relayEvents),
      },
    };
  } finally {
    if (options.keepTemp) process.stdout.write('[ticalc:tilem] kept ' + runPath + '\n');
    else rmSync(runPath, { recursive: true, force: true });
  }
}

function runSemanticRelay() {
  const tool = path.join(FIRMWARE, 'tools', 'test-virtual-relay.mjs');
  const result = spawnSync(process.execPath, [tool], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`semantic virtual relay failed: ${(result.stderr || result.stdout).trim()}`);
  }
  try {
    const report = JSON.parse(result.stdout);
    if (report?.state !== 'awaiting_calculator_commit'
        || !Array.isArray(report.flows)
        || !['catalog-download', 'quiz-upload', 'reportable-progress']
          .every((flow) => report.flows.includes(flow))
        || report?.calculatorCommit?.queueRetired !== true
        || report?.calculatorCommit?.deliveryRequestRetired !== true) {
      throw new Error('semantic relay completion report is incomplete');
    }
    return report;
  } catch (error) {
    throw new Error(`semantic virtual relay produced invalid JSON: ${error.message}`);
  }
}

/**
 * Provision a fresh MAME TI-86 through the same virtual Graph Link flow used
 * by the SchoolCalc release gate, then export its eight physical 16 KiB RAM
 * pages. TilEm's TI-86 core maps those RAM pages at physical 0x10..0x17.
 *
 * There is deliberately no TI-OS entry-point call, VAT mutation, or direct
 * installer here. A successful Graph Link transfer is required before MAME
 * exports the page image consumed by the raw BlackLink test.
 */
async function provisionMameRamImage({ options, descriptor, fixture, release, runPath, foregroundPrefix }) {
  const mameRoot = path.join(runPath, 'mame-provision');
  const romDirectory = path.join(mameRoot, 'roms', 'ti86');
  for (const directory of [romDirectory, 'nvram', 'cfg', 'input', 'state', 'snap']) {
    mkdirSync(path.isAbsolute(directory) ? directory : path.join(mameRoot, directory), { recursive: true });
  }
  writeFileSync(path.join(romDirectory, descriptor.filename), readFileSync(options.rom));
  const ramImage = path.join(runPath, 'mame-ti86-ram-pages.bin');
  const executionImage = path.join(runPath, 'mame-ti86-execution-page.bin');
  const cpuContext = path.join(runPath, 'mame-ti86-cpu-context.bin');
  const readyFile = path.join(mameRoot, 'transfer-complete');
  const scriptPath = path.join(mameRoot, 'provision.lua');
  const screenDirectory = path.join(mameRoot, 'launch-screens');
  mkdirSync(screenDirectory);
  writeFileSync(scriptPath, createMameRamSnapshotScript({
    readyFile, ramImage, executionImage, cpuContext, screenDirectory, foregroundPrefix,
  }));
  writeFileSync(path.join(mameRoot, 'resume.cmd'), 'go\n');

  const args = createTi86MameArguments({
    bios: descriptor.bios,
    romPath: path.join(mameRoot, 'roms'),
    scriptPath,
    debugScriptPath: path.join(mameRoot, 'resume.cmd'),
    workPath: mameRoot,
  });
  removeArgument(args, '-nothrottle');
  removeArgumentPair(args, '-seconds_to_run');
  args.push('-linkport', 'glinkhle', '-linkport:glinkhle:rs232', 'pty', '-seconds_to_run', '360');

  const beforePtys = new Set(listPtys());
  const mame = spawn(options.mame, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, SDL_VIDEODRIVER: 'dummy', SDL_AUDIODRIVER: 'dummy' },
  });
  const output = collectOutput(mame);
  // Keep the long-running virtual Graph Link gate observable to both a human
  // and non-interactive runners. The Lua script emits only state/PC markers,
  // never fixture payloads.
  mame.stdout.on('data', (chunk) => { process.stderr.write(`[ticalc:mame] ${chunk}`); });
  mame.stderr.on('data', (chunk) => { process.stderr.write(`[ticalc:mame] ${chunk}`); });
  try {
    const pty = await waitForPty(beforePtys, () => output.value, options.startupTimeoutMs);
    process.stderr.write(`[ticalc:mame] Graph Link ${pty}; waiting for emulator transport\n`);
    await delay(options.linkReadyDelayMs);
    const fixtureFiles = fixture.inputs.map(([name, record]) => {
      const file = path.join(runPath, `${name}.86s`);
      writeFileSync(file, createTi86StringFile({ name, record, comment: 'TilEm semantic relay fixture' }));
      return file;
    });
    const transferFiles = [
      ...release.manifest.transfer.map(({ fileName }) => path.join(release.bundle, fileName)),
      ...fixtureFiles,
    ];
    const transfer = await runGraphLinkTransfer(options.graphLink, transferFiles, pty, options.transferTimeoutMs,
      (line) => process.stderr.write(`[ticalc:graph-link] ${line}`));
    if (transfer.code !== 0) throw new Error(`MAME Graph Link provisioning failed: ${transfer.output}`);
    process.stderr.write('[ticalc:mame] Graph Link transfer complete; launching ASCHL through TI-OS\n');
    writeFileSync(readyFile, 'complete\n');
    const exited = await waitForExit(mame, options.provisionTimeoutMs, 'MAME Graph Link provisioning');
    if (exited.code !== 0 || !output.value.includes('TICALC_MAME_RAM_SNAPSHOT_PASS')) {
      throw new Error(`MAME Graph Link RAM snapshot failed: ${tail(output.value)}`);
    }
    for (const [key, count] of [['ON', 1], ['EXIT', 1], ['PRGM', 1], ['F1', 2], ['ENTER', 2], ['F5', 1]]) {
      const matches = output.value.match(new RegExp(`TICALC_MAME_LAUNCH_KEY key=${key}`, 'g')) ?? [];
      if (matches.length !== count) {
        throw new Error(`MAME TI-OS launch did not inject ${count} ${key} key event(s)`);
      }
    }
    if (!existsSync(ramImage) || readFileSync(ramImage).length !== 2 + (8 * 0x4000)
        || !existsSync(executionImage) || readFileSync(executionImage).length !== 0x4000
        || !existsSync(cpuContext) || readFileSync(cpuContext).length !== 20) {
      throw new Error('MAME Graph Link RAM snapshot has the wrong length');
    }
    if (!readFileSync(executionImage).subarray(0x1748, 0x1748 + foregroundPrefix.length).equals(foregroundPrefix)) {
      throw new Error('MAME shell did not load the validated SCSYNC binary before its foreground checkpoint');
    }
    const shellScreen = path.join(screenDirectory, 'ENTER-6.bin');
    if (!existsSync(shellScreen) || !hasSchoolCalcHeader(readFileSync(shellScreen))) {
      throw new Error('MAME TI-OS keyboard launch did not reach the SchoolCalc shell');
    }
    return { ramImage, executionImage, cpuContext };
  } finally {
    if (mame.exitCode == null && mame.signalCode == null) mame.kill('SIGTERM');
  }
}

function createMameRamSnapshotScript({
  readyFile, ramImage, executionImage, cpuContext, screenDirectory, foregroundPrefix,
}) {
  return `-- Generated MAME Graph Link-to-TilEm RAM bridge.\n`
    + `local READY_FILE=${lua(readyFile)}\nlocal RAM_IMAGE=${lua(ramImage)}\nlocal EXECUTION_IMAGE=${lua(executionImage)}\nlocal CPU_CONTEXT=${lua(cpuContext)}\nlocal SCREEN_DIRECTORY=${lua(screenDirectory)}\n`
    + `local cpu=manager.machine.devices[':maincpu']\n`
    + `local program=cpu and cpu.spaces['program'] or nil\n`
    + `local memoryio=cpu and cpu.spaces['io'] or nil\n`
    + `local SCSYNC_PREFIX={${[...foregroundPrefix].join(',')}}\n`
    + `local frame,index,deadline=0,0,0\nlocal phase='wait-transfer'\nlocal active=nil\n`
    + `local launch={\n`
    + `  {key='ON',port=':ON',mask=0x1,hold=12,settle=36},\n`
    + `  {key='EXIT',port=':BIT6',mask=0x40,hold=12,settle=36},\n`
    + `  {key='PRGM',port=':BIT6',mask=0x08,hold=12,settle=36},\n`
    + `  {key='F1',port=':BIT4',mask=0x40,hold=12,settle=24},\n`
    + `  {key='F1',port=':BIT4',mask=0x40,hold=12,settle=24},\n`
    + `  {key='ENTER',port=':BIT0',mask=0x02,hold=12,settle=1200},\n`
    + `  {key='ENTER',port=':BIT0',mask=0x02,hold=12,settle=300},\n`
    + `  {key='F5',port=':BIT0',mask=0x40,hold=12,settle=24}\n}\n`
    + `local function finish(kind, detail) print('TICALC_MAME_RAM_SNAPSHOT_'..kind..' '..detail); manager.machine:exit() end\n`
    + `local function ready() local f=io.open(READY_FILE,'rb'); if not f then return false end; f:close(); return true end\n`
    + `local function scsync_loaded()\n`
    + `  if not program then return false end\n`
    + `  for index,byte in ipairs(SCSYNC_PREFIX) do if program:read_u8(0xD748+index-1)~=byte then return false end end\n`
    + `  return true\n`
    + `end\n`
    + `local function capture(label)\n`
    + `  if not program then return end\n`
    + `  local pixels={}\n`
    + `  for address=0xFC00,0xFFFF do pixels[#pixels+1]=string.char(program:read_u8(address)) end\n`
    + `  local output=io.open(SCREEN_DIRECTORY..'/'..label..'.bin','wb')\n`
    + `  if output then output:write(table.concat(pixels)); output:close() end\n`
    + `end\n`
    + `local function snapshot()\n`
    + `  if not program or not memoryio then finish('FAIL','cpu-memory-or-io-space-unavailable'); return end\n`
    + `  local output=io.open(RAM_IMAGE,'wb'); if not output then finish('FAIL','cannot-open-ram-image'); return end\n`
    + `  local execution=io.open(EXECUTION_IMAGE,'wb'); if not execution then output:close(); finish('FAIL','cannot-open-execution-image'); return end\n`
    + `  local context=io.open(CPU_CONTEXT,'wb'); if not context then output:close(); execution:close(); finish('FAIL','cannot-open-cpu-context'); return end\n`
    + `  local old5=memoryio:read_u8(0x05)\nlocal old6=memoryio:read_u8(0x06)\n`
    + `  local calls={}\n`
    + `  for _,address in ipairs({0x45F3,0x472F,0x4AB1,0x4C3F,0x5285}) do calls[#calls+1]=string.format('%04X=%02X',address,program:read_u8(address)) end\n`
    + `  print(string.format('TICALC_MAME_FOREGROUND_MAP p5=%02X p6=%02X %s',old5,old6,table.concat(calls,' ')))\n`
    + `  output:write(string.char(old5,old6))\n`
    + `  local cpu_fields={'AF','BC','DE','HL','IX','IY','SP','PC'}\n`
    + `  local entry_marker={program:read_u8(0xD700),program:read_u8(0xD701),program:read_u8(0xD702),program:read_u8(0xD703)}\n`
    + `  context:write('TSC1')\n`
    + `  for index,name in ipairs(cpu_fields) do\n`
    + `    local field=cpu.state[name]; if not field then output:close(); execution:close(); context:close(); finish('FAIL','missing-cpu-state-'..name); return end\n`
    + `    local value=field.value\n`
    + `    if entry_marker[1]==0x53 and entry_marker[2]==0x43 and entry_marker[3]==0x45 and entry_marker[4]==0x31 then value=program:read_u8(0xD700+(index*2+2))+256*program:read_u8(0xD700+(index*2+3)) end\n`
    + `    context:write(string.char(value%256,math.floor(value/256)%256))\n`
    + `  end\n`
    + `  for address=0xC000,0xFFFF do execution:write(string.char(program:read_u8(address))) end\n`
    + `  for page=0,7 do\n`
    + `    memoryio:write_u8(0x05,0x40+page)\n`
    + `    local bytes={}\n`
    + `    for address=0x4000,0x7fff do bytes[#bytes+1]=string.char(program:read_u8(address)) end\n`
    + `    output:write(table.concat(bytes))\n`
    + `  end\n`
    + `  memoryio:write_u8(0x05,old5)\n`
    + `  output:close()\n`
    + `  execution:close()\n`
    + `  context:close()\n`
    + `  finish('PASS','pages=8')\n`
    + `end\n`
    + `local function press_next()\n`
    + `  index=index+1\n`
    + `  if index>#launch then phase='await-sync'; return end\n`
    + `  local step=launch[index]\n`
    + `  if step.key=='F5' and cpu and cpu.debug then cpu.debug:bpset(0xD75E,nil,'b@D700=53;b@D701=43;b@D702=45;b@D703=31;b@D704=af&ff;b@D705=af>>8;b@D706=bc&ff;b@D707=bc>>8;b@D708=de&ff;b@D709=de>>8;b@D70A=hl&ff;b@D70B=hl>>8;b@D70C=ix&ff;b@D70D=ix>>8;b@D70E=iy&ff;b@D70F=iy>>8;b@D710=sp&ff;b@D711=sp>>8;b@D712=pc&ff;b@D713=pc>>8;g') end\n`
    + `  active=manager.machine.ioport.ports[step.port] and manager.machine.ioport.ports[step.port]:field(step.mask) or nil\n`
    + `  if not active then finish('FAIL','missing-key-'..step.key); return end\n`
    + `  print('TICALC_MAME_LAUNCH_KEY key='..step.key)\n`
    + `  active:set_value(1); deadline=frame+step.hold; phase='release-key'\n`
    + `end\n`
    + `emu.register_frame_done(function()\n`
    + `  frame=frame+1\n`
    + `  if frame%300==0 and cpu and cpu.state and (cpu.state['PC'] or cpu.state['rPC']) then print(string.format('TICALC_MAME_LAUNCH_HEARTBEAT frame=%d phase=%s pc=%04X',frame,phase,(cpu.state['PC'] or cpu.state['rPC']).value)) end\n`
    + `  if frame==40 then local port=manager.machine.ioport.ports[':ON']; local key=port and port:field(0x1); if key then key:set_value(1) end\n`
    + `  elseif frame==52 then local port=manager.machine.ioport.ports[':ON']; local key=port and port:field(0x1); if key then key:clear_value() end\n`
    + `  elseif phase=='wait-transfer' and ready() then press_next()\n`
    + `  elseif phase=='release-key' and frame>=deadline then\n`
    + `    active:clear_value(); active=nil; deadline=frame+launch[index].settle; phase='settle-key'\n`
    + `  elseif phase=='settle-key' and frame>=deadline then capture(launch[index].key..'-'..index); press_next()\n`
    + `  elseif phase=='await-sync' and scsync_loaded() then\n`
    + `    capture('SCSYNC-LOADED'); snapshot()\n`
    + `  end\n`
    + `  if frame>=9000 then finish('FAIL','timeout') end\n`
    + `end,'ticalc_mame_ram_snapshot')\n`;
}

function loadMameRelease(bundle) {
  if (!existsSync(bundle)) throw new Error(`MAME release bundle is missing: ${bundle}`);
  const manifestPath = path.join(bundle, 'complete-install.json');
  if (!existsSync(manifestPath)) throw new Error(`MAME release manifest is missing: ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest?.schema !== 'school.calc.ti86-complete-install/v1') {
    throw new Error('MAME release bundle has an invalid complete-install manifest');
  }
  for (const entry of manifest.transfer ?? []) {
    const file = path.join(bundle, entry.fileName);
    if (!existsSync(file) || sha256(readFileSync(file)) !== entry.sha256) {
      throw new Error(`MAME release file is missing or changed: ${entry.fileName}`);
    }
  }
  const launcher = manifest.transfer.find(({ fileName }) => fileName === 'ASCHL.86p');
  const sync = manifest.transfer.find(({ fileName }) => fileName === 'SCSYNC.86p');
  if (!launcher || !sync) {
    throw new Error('MAME release bundle must contain validated ASCHL and SCSYNC binaries');
  }
  return { bundle, manifest };
}

function prepareMameRelease(baseRelease, syncProgram, runPath) {
  const sync = readFileSync(syncProgram);
  const transfer = baseRelease.manifest.transfer.map((entry) => (
    entry.fileName === 'SCSYNC.86p'
      ? { ...entry, byteLength: sync.length, sha256: sha256(sync) }
      : entry
  ));
  const releaseId = sha256(Buffer.from(JSON.stringify(transfer))).slice(0, 12);
  const bundle = path.join(runPath, `install-ti86a-${releaseId}`);
  mkdirSync(bundle, { recursive: true });
  for (const entry of transfer) {
    const source = entry.fileName === 'SCSYNC.86p'
      ? syncProgram : path.join(baseRelease.bundle, entry.fileName);
    copyFileSync(source, path.join(bundle, entry.fileName));
  }
  copyFileSync(path.join(baseRelease.bundle, 'schoolcalc-client-release.json'),
               path.join(bundle, 'schoolcalc-client-release.json'));
  const manifest = { ...baseRelease.manifest, releaseId, transfer };
  writeFileSync(path.join(bundle, 'complete-install.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { bundle, manifest };
}

export function createSemanticFixture(runPath) {
  const codec = new Ti86SchoolCalcCodec();
  const deviceId = '86A001';
  const artifact = codec.compile(semanticLesson());
  const records = [
    ['DSID', codec.encodeDeviceIdentity({ deviceId })],
    ['DSINFO', encodeTi86DeviceInfo({
      shellVersion: '0.1.0', deviceId, capabilities: ['shell-core@1'],
      installedArtifactIds: [], freeBytes: 40_000, maxArtifactBytes: 12_288, runtimeModuleMask: 0,
    })],
    ['DSINST', codec.encodeSyncManifest(emptyInstalledPlan(deviceId))],
    ['DSQ', encodeTi86ResultQueue({ deviceId, records: [
      encodeTi86ResultRecord({
        schema: 'school.calc.result/v1', kind: 'responses', deviceId, sequence: 17, learnerKey: 4,
        artifactId: artifact.artifactId, moduleIndex: 0, responses: [{ itemIndex: 0, given: 2 }],
        localScore: { correct: 1, total: 1, percent: 100, basis: 'embedded_answer_key' },
      }),
      encodeTi86ResultRecord({
        schema: 'school.calc.result/v1', kind: 'progress', deviceId, sequence: 18, learnerKey: 4,
        artifactId: artifact.artifactId, moduleIndex: 0,
        progress: { status: 'completed', position: 1, total: 1 },
      }),
    ] })],
    ['DSREQ', encodeTi86DeliveryRequests({ deviceId, requests: [{
      requestId: 7, learnerKey: 4, action: 'install', address: semanticLesson().address,
    }] })],
    ['DSTREQ', encodeTi86InteractionRequest({
      schema: 'school.calc.interaction-request/v1', deviceId, learnerKey: 4, requestId: 23,
      action: 'choice', sessionId: 'REM_ABC123', clientSequence: 1, lastServerSequence: 1,
      turnId: 'TURN_1', choiceId: 'A',
    })],
  ];
  const outputs = [
    ['SCA1', codec.encodeAcknowledgements({ deviceId, sequences: [17, 18] })],
    ['SCM1', codec.encodeSyncManifest({
      ...emptyInstalledPlan(deviceId), generation: 'sha256:tilem-plan-v1',
      catalog: { generation: 'sha256:tilem-catalog-v1', changed: true },
      artifacts: [artifact], installedArtifacts: [artifact],
      acknowledgements: { sequences: [17, 18] }, deliveryAcknowledgements: { requestIds: [7] },
    })],
    ['SCU1', codec.encodeLearnerRoster({
      schema: 'school.calc.learner-roster/v1', deviceId, generation: 'sha256:tilem-profiles-v1',
      profiles: [{ learnerKey: 4, label: 'Test Learner' }],
    })],
    ['SCG1', codec.encodeProgressProjection(semanticProgress(deviceId))],
    ['SCTR', codec.encodeInteractionResponse({
      schema: 'school.calc.interaction-response/v1', deviceId, learnerKey: 4, requestId: 23,
      status: 'complete', acknowledgeRequest: true, retryable: false, message: 'Recorded.',
    })],
    ['SCC1', codec.encodeCatalog({
      schema: 'school.calc.catalog-projection/v1', platformId: 'ti86', deviceId,
      generation: 'sha256:tilem-catalog-v1', catalogs: [{ catalogId: 'main', title: 'Main', subjects: [] }],
    })],
    ['SCP1', artifact.bytes],
  ];
  verifySemanticFixture({ codec, deviceId, artifact, records, outputs });
  const directory = path.join(runPath, 'semantic-fixture');
  mkdirSync(directory);
  for (const [name, bytes] of records) writeFileSync(path.join(directory, `${name}.bin`), bytes);
  for (const [name, bytes] of outputs) writeFileSync(path.join(directory, `${name}.bin`), bytes);
  return { directory, inputs: records };
}

function emptyInstalledPlan(deviceId) {
  return {
    schema: 'school.calc.sync-plan/v1', deviceId, platformId: 'ti86', generation: 'sha256:tilem-installed-v1',
    catalog: { generation: 'sha256:tilem-old-catalog-v1', changed: false }, ready: true, blockers: [],
    removals: [], artifacts: [], installedArtifacts: [], acknowledgements: { sequences: [] },
    deliveryAcknowledgements: { requestIds: [] },
  };
}

function semanticLesson() {
  return {
    schema: 'school.learning-lesson/v1', address: 'main/markets/finance/interest/compound-growth',
    context: {
      catalog: { catalogId: 'main', title: 'Main Catalog' }, subject: { subjectId: 'markets', title: 'Markets' },
      course: { courseId: 'finance', title: 'Finance' }, unit: { unitId: 'interest', title: 'Interest' },
    },
    lesson: {
      lessonId: 'compound-growth', title: 'Compound growth', objectives: ['Compare growth'],
      modules: [{
        moduleId: 'quiz', type: 'quiz', bankId: 'finance:compound-check', passingPercent: 80,
        bank: { id: 'finance:compound-check', title: 'Check', items: [{
          id: 'q1', type: 'multiple_choice', prompt: 'Which grows?',
          choices: ['Principal', 'Principal plus interest'], answer: 'Principal plus interest',
        }] },
      }],
    },
    capabilities: ['quiz@1', 'response.choice@1'],
  };
}

function semanticProgress(deviceId) {
  return {
    schema: 'school.calc.progress-projection/v1', deviceId, generation: 'sha256:tilem-progress-v1',
    profiles: [{
      learnerKey: 4,
      summary: {
        evidenceCount: 2, engagementCount: 2, responseCount: 1, correctCount: 1, completionCount: 1,
        activityCount: 1, assessmentCount: 1, scorePercent: 100, lastActivityAt: '2026-08-03T12:00:00.000Z',
      },
      recentScores: [{
        activityKind: 'quiz', occurredAt: '2026-08-03T12:00:00.000Z', verification: 'verified',
        score: { correct: 1, total: 1, percent: 100 },
      }],
      followUps: [],
      curriculumHistory: { roots: [] },
    }],
  };
}

function verifySemanticFixture({ codec, deviceId, artifact, records, outputs }) {
  const byName = new Map(records);
  const queuedResults = decodeTi86ResultQueueRecord(byName.get('DSQ')).records.map((record) => codec.decodeResult(record));
  if (codec.decodeDeviceIdentity(byName.get('DSID')).deviceId !== deviceId
      || codec.describeCapabilities(byName.get('DSINFO')).deviceId !== deviceId
      || decodeTi86SyncManifest(byName.get('DSINST')).catalogChanged
      || queuedResults.map((result) => `${result.deviceId}:${result.artifactId}:${result.sequence}:${result.kind}`).join(',')
        !== `86A001:${artifact.artifactId}:17:responses,86A001:${artifact.artifactId}:18:progress`
      || decodeTi86InteractionRequest(byName.get('DSTREQ')).requestId !== 23
      || codec.decodeDeliveryRequests(byName.get('DSREQ')).requests[0].requestId !== 7) {
    throw new Error('semantic TilEm fixture did not round-trip through the production TI-86 codec');
  }
  const output = new Map(outputs);
  if (decodeTi86Acknowledgements(output.get('SCA1')).sequences.join(',') !== '17,18'
      || !decodeTi86SyncManifest(output.get('SCM1')).catalogChanged
      || decodeTi86ProgressProjection(output.get('SCG1')).profiles[0].summary.scorePercent !== 100
      || decodeTi86InteractionResponse(output.get('SCTR')).requestId !== 23
      || decodeTi86Envelope(output.get('SCC1'), 'SCC1').generation !== 'sha256:tilem-catalog-v1'
      || decodeTi86Envelope(output.get('SCP1'), 'SCP1').artifactId !== artifact.artifactId) {
    throw new Error('semantic TilEm responses did not round-trip through the production TI-86 codec');
  }
}

function verifyTilemSource(source) {
  const revision = spawnSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  const actual = revision.status === 0 ? revision.stdout.trim() : null;
  if (actual !== TILEM_DEBIAN_REVISION) {
    throw new Error(`TilEm source revision must be ${TILEM_DEBIAN_REVISION}; found ${actual ?? 'not-a-git-checkout'}`);
  }
  const dirty = spawnSync('git', ['-C', source, 'diff', '--quiet'], { encoding: 'utf8' });
  if (dirty.status !== 0) throw new Error('TilEm source checkout must be clean for a reproducible wire gate');
}

function buildHarness(runPath, options) {
  const core = path.join(runPath, 'tilem-core');
  const objects = buildTilemCore(core, options);
  const output = path.join(runPath, 'tilem-virtual-relay');
  const src = (...parts) => path.join(FIRMWARE, ...parts);
  const tilem = src('test', 'tilem');
  const host = src('test', 'mame', 'host');
  const compile = spawnSync(options.cxx, [
    '-std=c++17', '-Wall', '-Wextra', '-Werror', '-pthread', '-Drestrict=__restrict',
    '-I', host, '-I', tilem, '-I', src('src'), '-I', path.join(options.tilemSource, 'emu'),
    path.join(tilem, 'TilemSupport.cpp'),
    path.join(tilem, 'TilemHostArduinoShim.cpp'),
    path.join(tilem, 'TilemBlackLinkBridge.cpp'),
    path.join(tilem, 'tilem_virtual_relay_main.cpp'),
    src('src', 'SchoolCalcWire.cpp'),
    src('src', 'SchoolCalcForegroundWire.cpp'),
    src('src', 'SchoolCalcForegroundSession.cpp'),
    src('src', 'SchoolCalcRelaySession.cpp'),
    src('src', 'TiLinkTransport.cpp'),
    src('src', 'SchoolCalcTiLinkAdapters.cpp'),
    objects.archive,
    '-o', output,
  ], { cwd: core, encoding: 'utf8' });
  if (compile.status !== 0) {
    throw new Error('could not compile TilEm virtual relay: ' + (compile.stderr || compile.stdout || '').trim());
  }
  return output;
}

function buildTilemCore(core, options) {
  mkdirSync(core, { recursive: true });
  const emu = path.join(options.tilemSource, 'emu');
  const sourceFiles = [
    'calcs.c', 'z80.c', 'state.c', 'rom.c', 'flash.c', 'link.c', 'keypad.c', 'lcd.c',
    'cert.c', 'md5.c', 'timers.c', 'monolcd.c', 'graylcd.c', 'grayimage.c', 'graycolor.c',
    'x7/x7_init.c', 'x7/x7_io.c', 'x7/x7_memory.c', 'x7/x7_subcore.c',
    'x1/x1_init.c', 'x1/x1_io.c', 'x1/x1_memory.c', 'x1/x1_subcore.c',
    'x2/x2_init.c', 'x2/x2_io.c', 'x2/x2_memory.c', 'x2/x2_subcore.c',
    'x3/x3_init.c', 'x3/x3_io.c', 'x3/x3_memory.c', 'x3/x3_subcore.c',
    'xp/xp_init.c', 'xp/xp_io.c', 'xp/xp_memory.c', 'xp/xp_subcore.c',
    'xs/xs_init.c', 'xs/xs_io.c', 'xs/xs_memory.c', 'xs/xs_subcore.c',
    'x4/x4_init.c', 'x4/x4_io.c', 'x4/x4_memory.c', 'x4/x4_subcore.c',
    'xz/xz_init.c', 'xz/xz_io.c', 'xz/xz_memory.c', 'xz/xz_subcore.c',
    'xn/xn_init.c', 'xn/xn_io.c', 'xn/xn_memory.c', 'xn/xn_subcore.c',
    'x5/x5_init.c', 'x5/x5_io.c', 'x5/x5_memory.c', 'x5/x5_subcore.c',
    'x6/x6_init.c', 'x6/x6_io.c', 'x6/x6_memory.c', 'x6/x6_subcore.c',
  ];
  for (const source of sourceFiles) {
    if (!existsSync(path.join(emu, source))) throw new Error('TilEm source is incomplete: ' + source);
  }
  const compile = spawnSync(options.cc, [
    '-std=c99', '-O2', '-DPACKAGE_VERSION="2.0"', '-I', emu, '-c',
    ...sourceFiles.map((source) => path.join(emu, source)),
  ], { cwd: core, encoding: 'utf8' });
  if (compile.status !== 0) {
    throw new Error('could not compile TilEm core: ' + (compile.stderr || compile.stdout || '').trim());
  }
  const objectFiles = sourceFiles.map((source) => path.basename(source, '.c') + '.o');
  const archive = path.join(core, 'libtilemcore.a');
  const ar = spawnSync(options.ar, ['rcs', archive, ...objectFiles], { cwd: core, encoding: 'utf8' });
  if (ar.status !== 0) throw new Error('could not archive TilEm core: ' + (ar.stderr || ar.stdout || '').trim());
  return { archive };
}

function runHarness(binary, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const output = { value: '' };
    child.stdout.on('data', (chunk) => { output.value += String(chunk); });
    child.stderr.on('data', (chunk) => { output.value += String(chunk); });
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      resolve({ code: 1, output: error.message });
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, output: output.value });
    });
  });
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

function runGraphLinkTransfer(command, files, device, timeoutMs, onOutput = () => {}) {
  return new Promise((resolve) => {
    const child = spawn(command, ['send', ...files], {
      env: { ...process.env, TI86_CABLE_DEVICE: device }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += String(chunk); onOutput(String(chunk)); });
    child.stderr.on('data', (chunk) => { output += String(chunk); onOutput(String(chunk)); });
    let hardStop = null;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      hardStop = setTimeout(() => child.kill('SIGKILL'), 1_000);
    }, timeoutMs);
    const startedAt = Date.now();
    const progress = setInterval(() => {
      onOutput(`transfer active (${Math.floor((Date.now() - startedAt) / 1000)}s)\n`);
    }, 5_000);
    child.once('error', (error) => {
      clearTimeout(timer);
      clearInterval(progress);
      if (hardStop) clearTimeout(hardStop);
      resolve({ code: 1, output: error.message });
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      clearInterval(progress);
      if (hardStop) clearTimeout(hardStop);
      resolve({ code: code ?? 1, output: output.trim() });
    });
  });
}

function collectOutput(child) {
  const output = { value: '' };
  child.stdout.on('data', (chunk) => { output.value += String(chunk); });
  child.stderr.on('data', (chunk) => { output.value += String(chunk); });
  return output;
}

function waitForExit(child, timeoutMs, name) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${name} timed out`));
    }, timeoutMs);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
}

function removeArgument(args, token) {
  const index = args.indexOf(token);
  if (index >= 0) args.splice(index, 1);
}

function removeArgumentPair(args, token) {
  const index = args.indexOf(token);
  if (index >= 0) args.splice(index, 2);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function lua(value) {
  return `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

function parseKeyValueFile(file) {
  if (!existsSync(file)) throw new Error('TilEm relay did not write completion report');
  return Object.fromEntries(readFileSync(file, 'utf8').trim().split('\n').filter(Boolean)
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index), line.slice(index + 1)];
    }));
}

function parseArguments(args) {
  const options = {
    rom: process.env.TI86_ROM ?? null,
    tilemSource: process.env.TILEM_SOURCE ?? null,
    syncProgram: path.join(TI86_APP, 'dist', 'SCSYNC.86p'),
    bundle: path.join(TI86_APP, 'dist', 'install-ti86a-5055ef0944b1'),
    cc: process.env.CC ?? 'cc',
    cxx: process.env.CXX ?? 'c++',
    ar: process.env.AR ?? 'ar',
    mame: process.env.MAME ?? 'mame',
    graphLink: process.env.TI86_GRAPH_LINK ?? '/private/tmp/ti86-graph-link-next',
    timeoutMs: 45_000,
    startupTimeoutMs: 15_000,
    linkReadyDelayMs: 3_000,
    transferTimeoutMs: 240_000,
    provisionTimeoutMs: 360_000,
    keepTemp: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--rom' && args[index + 1]) options.rom = path.resolve(args[++index]);
    else if (value === '--tilem-source' && args[index + 1]) options.tilemSource = path.resolve(args[++index]);
    else if (value === '--sync-program' && args[index + 1]) options.syncProgram = path.resolve(args[++index]);
    else if (value === '--bundle' && args[index + 1]) options.bundle = path.resolve(args[++index]);
    else if (value === '--mame' && args[index + 1]) options.mame = args[++index];
    else if (value === '--graph-link' && args[index + 1]) options.graphLink = path.resolve(args[++index]);
    else if (value === '--timeout-ms' && args[index + 1]) options.timeoutMs = Number(args[++index]);
    else if (value === '--keep-temp') options.keepTemp = true;
    else throw new Error('usage: test-tilem-wire-relay.mjs [--rom PATH] [--tilem-source PATH] [--bundle PATH] [--sync-program PATH] [--mame COMMAND] [--graph-link PATH] [--timeout-ms N] [--keep-temp]');
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1_000) throw new Error('timeout must be at least 1000 ms');
  return options;
}

function tail(text, count = 40) {
  return text.trim().split('\n').slice(-count).join('\n');
}

function isMainModule() {
  return process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}
