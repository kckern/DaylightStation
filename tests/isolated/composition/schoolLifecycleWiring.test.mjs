// @vitest-environment node
//
// Composition-root wiring for the School physical console.
//
// Two things are under test, and both are the kind of thing that breaks silently:
//
//  1. **Fail closed.** The console must not wire itself without an explicit
//     opt-in, and must never mount the virtual device console (which can knock a
//     printer offline) on a real deployment.
//  2. **The relay branch is non-disruptive.** A new claim at the TOP of a shared
//     scan router is exactly where an existing consumer gets shadowed. The school
//     prefix is asserted against every code shape the `content` and `nutribot`
//     routes actually carry, and "school first, whatever the route" is asserted
//     against the scan vocabulary that now decides it — because "first" is the
//     whole requirement and nothing else pins it.
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
    getHouseholdPath: (rel) => `${dataDir}/household/${rel}`,
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
      'issueDocument', 'markSessionAbandoned', 'openRemediation', 'previewAgenda',
      'recordMediaCompletion', 'resolvePersonalCard', 'resolveReviewItem',
      'resolveScanAction', 'setAssignments', 'submitPaperWork',
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
  // The `onScan` if-chain these tests used to grep out of `app.mjs` no longer
  // exists: every scan now resolves through the shared scan vocabulary
  // (`ScanCode` -> `ScanDispatcher`), wired in `5_composition/modules/
  // scanDispatch.mjs`. The REQUIREMENT is unchanged and still the whole point —
  // school is reached first, whatever route the reader is on — so it is asserted
  // where it now lives, and behaviourally rather than by source position.
  const dispatchSource = async () => readFile(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..',
      'backend', 'src', '5_composition', 'modules', 'scanDispatch.mjs',
    ),
    'utf8',
  );

  it('school outranks the reader route for every reader in the house', async () => {
    const { parseScanCode } = await import('#domains/scan/ScanCode.mjs');
    // The parse claims the token, and a claimed namespace is never overridden by
    // `route` (the dispatcher consults its fallback only when `namespace` is
    // null) — which is what "first, and route-independent" now means.
    for (const code of ['sch:A7F3K2', 'sch:23456789ABCDEFGH']) {
      expect(parseScanCode(code)).toMatchObject({ namespace: 'school', raw: code });
    }
  });

  it('the school branch returns, so it can never fall through into another route', async () => {
    const { ScanDispatcher } = await import('#apps/scan/ScanDispatcher.mjs');
    const school = { namespace: 'school', handle: () => ({ status: 'dispatched' }) };
    const product = { namespace: 'product', handle: () => ({ status: 'logged' }) };
    const dispatcher = new ScanDispatcher({
      handlers: [school, product], routeFallback: { nutribot: 'product' },
    });
    // Scanned on the FRIDGE reader, which falls back to a product lookup.
    const out = await dispatcher.dispatch({
      code: 'sch:A7F3K2', device: 'nutribot-upc', route: 'nutribot',
    });
    expect(out.domain).toBe('school');
  });

  it('the existing branches are untouched by it', async () => {
    // Was a source grep for the literal `routeNutribotScan(...)` call. That broke
    // on reformatting and proved nothing a behaviour test does not: school being
    // registered BESIDE the other domains rather than threaded through them is
    // exactly what "each keeps its own handler" means, and the two tests above
    // already pin it. What is left worth asserting is that the other domains are
    // still reachable at all — a school branch that had swallowed one of them
    // would show up here and nowhere else.
    const { createScanDispatch } = await import('#composition/modules/scanDispatch.mjs');
    // The full bag is REQUIRED: `assertDeps` refuses to build on a partial one,
    // because a silently-missing dependency is how the composition seam breaks
    // without any gate noticing. `applyScanToComposition: null` is legal and
    // means nutriscan is disabled; the getters are late-bound by contract.
    const { namespaces } = createScanDispatch({
      schoolLifecycle: { handlesCode: () => false, handleScan: null },
      schoolCalcResultImporter: null,
      triggerDispatchService: { handleEvent: async () => {} },
      relayInstances: {}, relayConfig: {},
      applyScanToComposition: null,
      getScaleNutribotBridge: () => null,
      getLogFoodFromUPC: () => null,
      screenNames: [],
      configService: {}, userIdentityService: {}, logger: silent, barcodeLogger: silent,
    });
    expect(namespaces).toEqual(
      expect.arrayContaining(['content', 'command', 'school', 'nutrition', 'product']),
    );
  });
});
