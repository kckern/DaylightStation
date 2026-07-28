// @vitest-environment node
//
// Composition-root wiring for the School physical console.
//
// Two things are under test, and both are the kind of thing that breaks silently:
//
//  1. **Fail closed.** The console must not wire itself without an explicit
//     opt-in, and must never mount the virtual device console (which can knock a
//     printer offline) on a real deployment.
//  2. **The relay branch is non-disruptive.** A new branch at the TOP of a
//     shared `onScan` router is exactly where an existing consumer gets
//     shadowed. The school prefix is asserted against every code shape the
//     `content` and `nutribot` routes actually carry, and the branch ORDER in
//     `app.mjs` is asserted against the source, because "first" is the whole
//     requirement and nothing else pins it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSchoolLifecycle } from '#composition/modules/schoolLifecycle.mjs';
import { isSchoolToken } from '#domains/school/sessions/tokens.mjs';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

let dataDir;

beforeEach(async () => { dataDir = await mkdtemp(path.join(os.tmpdir(), 'school-lifecycle-')); });
afterEach(async () => { await rm(dataDir, { recursive: true, force: true }); });

const wire = (schoolConfig) => createSchoolLifecycle({
  configService: {
    getHouseholdAppConfig: () => schoolConfig,
    getDataDir: () => dataDir,
    getDeviceConfig: () => null,
  },
  schoolService: { listBanks: () => [], getBank: () => null },
  eventBus: { broadcast() {}, onClientMessage() {}, subscribe() {} },
  logger: silent,
});

describe('fail closed', () => {
  it('stays unwired with no lifecycle block at all', async () => {
    const result = await wire({});
    expect(result).toMatchObject({ wired: false, router: null, devicesRouter: null, reporter: null });
    expect(result.reason).toContain('lifecycle.enabled');
  });

  it('stays unwired when the flag is anything other than true', async () => {
    for (const enabled of ['true', 1, null, undefined]) {
      // eslint-disable-next-line no-await-in-loop
      expect((await wire({ lifecycle: { enabled } })).wired).toBe(false);
    }
  });

  it('stays unwired with no laser printer to print to', async () => {
    const result = await wire({ lifecycle: { enabled: true } });
    expect(result.wired).toBe(false);
    expect(result.reason).toContain('printer');
  });

  it('wires against a real printer host, with NO device console', async () => {
    const result = await wire({ lifecycle: { enabled: true }, printing: { host: 'printer.local' } });
    expect(result).toMatchObject({ wired: true });
    expect(result.router).toBeTruthy();
    expect(result.reporter).toBeTruthy();
    // The one thing a production deployment must never expose.
    expect(result.devicesRouter).toBeNull();
    expect(result.devices).toEqual({});
  });

  it('wires the doubles ONLY on the explicit virtualDevices flag', async () => {
    const result = await wire({ lifecycle: { enabled: true }, virtualDevices: true });
    expect(result.wired).toBe(true);
    expect(result.devicesRouter).toBeTruthy();
    expect(Object.keys(result.devices).sort()).toEqual(['laserPrinter', 'omrReader', 'playback', 'scanner', 'thermalPrinter']);
  });

  it('shares ONE printer instance between the console and the use cases', async () => {
    const result = await wire({ lifecycle: { enabled: true }, virtualDevices: true });
    // Two instances would mean the console showing an empty tray while
    // IssueDocument printed happily into a different one.
    const captured = result.devices.laserPrinter;
    await captured.printPdf(Buffer.from('%PDF-1.4\n/Type /Page\n%%EOF'), { jobName: 'probe' });
    expect(result.devices.laserPrinter.listJobs()).toHaveLength(1);
    expect(result.stores.formMaps).toBeTruthy();
  });

  it('exposes the whole use-case graph once wired', async () => {
    const { useCases } = await wire({ lifecycle: { enabled: true }, virtualDevices: true });
    expect(Object.keys(useCases).sort()).toEqual([
      'buildAgenda', 'closeSessionOutcome', 'dispatchMedia', 'gradeSubmission',
      'issueDocument', 'openRemediation', 'recordMediaCompletion',
      'resolvePersonalCard', 'resolveScanAction', 'submitPaperWork',
    ]);
  });

  it('an unwired console answers no code, so the relay branch is a no-op', async () => {
    const result = await wire({});
    expect(result.handlesCode('sch:ANYTHING')).toBe(false);
    expect(result.handleScan).toBeNull();
  });
});

describe('the relay branch cannot shadow an existing consumer', () => {
  const wired = async () => wire({ lifecycle: { enabled: true }, virtualDevices: true });

  it('claims school tokens', async () => {
    const { handlesCode } = await wired();
    expect(handlesCode('sch:2K7QVM4X9HRJTBNP')).toBe(true);
    expect(handlesCode('  sch:2K7QVM4X9HRJTBNP  ')).toBe(true);
  });

  it.each([
    ['UPC-A', '012345678905'],
    ['EAN-13', '4006381333931'],
    ['UPC-E', '01234565'],
    ['nutribot delete', 'dl:4'],
    ['nutribot category', 'ct:2'],
    ['nutribot rescan', 'rs:1'],
    ['content id', 'plex:481203'],
    ['trigger value', 'kitchen-lights-on'],
  ])('leaves a %s code to its own route', async (_label, code) => {
    const { handlesCode } = await wired();
    expect(handlesCode(code)).toBe(false);
    expect(isSchoolToken(code)).toBe(false);
  });

  it('claims nothing at all from junk input', async () => {
    const { handlesCode } = await wired();
    [null, undefined, '', 42, {}].forEach((code) => expect(handlesCode(code)).toBe(false));
  });
});

describe('branch order in the composition root', () => {
  const appSource = async () => readFile(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'backend', 'src', 'app.mjs'),
    'utf8',
  );

  it('the school branch sits FIRST in onScan, ahead of nutribot and the trigger fallback', async () => {
    const source = await appSource();
    const onScan = source.indexOf('onScan: (relay) => {');
    expect(onScan).toBeGreaterThan(-1);
    const school = source.indexOf('schoolLifecycle.handlesCode(relay.code)', onScan);
    const nutribot = source.indexOf("route === 'nutribot'", onScan);
    const trigger = source.indexOf('TriggerEvent.create({', onScan);
    expect(school).toBeGreaterThan(onScan);
    expect(school).toBeLessThan(nutribot);
    expect(nutribot).toBeLessThan(trigger);
  });

  it('the school branch returns, so it can never fall through into another route', async () => {
    const source = await appSource();
    const school = source.indexOf('schoolLifecycle.handlesCode(relay.code)');
    const nutribot = source.indexOf("route === 'nutribot'", school);
    expect(source.slice(school, nutribot)).toContain('return;');
  });

  it('the existing branches are untouched by it', async () => {
    const source = await appSource();
    // The two decisions the nutribot route is built on, and the trigger
    // fallback's source tag. If the school branch had been threaded THROUGH
    // either of them rather than placed ahead, one of these would have moved.
    expect(source).toContain('const decision = routeNutribotScan({ scaleId, code: relay.code, apply: applyScanToComposition });');
    expect(source).toContain("source: 'barcode',");
  });
});
