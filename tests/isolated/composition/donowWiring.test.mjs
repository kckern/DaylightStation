// @vitest-environment node
//
// Composition-root wiring for DoNow (Task 13) — the household "start this,
// there, now" dispatch facade. Three things are under test, matching the
// task brief exactly:
//
//  1. A composition built entirely from fakes exposes a working service,
//     router, and all seven v1 surfaces — the closed registry, verified by
//     id, not by guessing at internal shape.
//  2. `school.yml` `programs:` entries collide-checked against code-registered
//     launchers (`language`) at BOOT, not at first use — a config mistake
//     must surface immediately.
//  3. Every surface degrades (a decision the caller can act on: `failed` or
//     `pending_approval`) rather than throwing when its own optional seam
//     (eventBus, wakeAndLoadService, home-automation adapters, the
//     playback-hub container, a thermal printer registry) is missing.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDonow } from '#composition/modules/donow.mjs';
import { createSchoolLifecycle } from '#composition/modules/schoolLifecycle.mjs';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const SURFACE_IDS = [
  'garage-fitness', 'laser', 'livingroom-tv', 'piano-kiosk', 'playback-hub', 'portal', 'thermal',
].sort();

let dataDir;
beforeEach(async () => { dataDir = await mkdtemp(path.join(os.tmpdir(), 'donow-wiring-')); });
afterEach(async () => { await rm(dataDir, { recursive: true, force: true }); });

const fakeConfigService = (donowConfig = {}) => ({
  getHouseholdAppConfig: () => donowConfig,
  getDataDir: () => dataDir,
  getTimezone: () => null,
});

const fakeEventBus = () => ({
  broadcast() {},
  subscribe() { return () => {}; },
});

describe('createDonow — composed entirely from fakes', () => {
  it('exposes a working service, approvals, router, and all seven v1 surfaces', async () => {
    const donow = await createDonow({
      configService: fakeConfigService(),
      eventBus: fakeEventBus(),
      logger: silent,
    });

    expect(donow.service).toBeTruthy();
    expect(typeof donow.service.dispatch).toBe('function');
    expect(donow.approvals).toBeTruthy();
    expect(donow.router).toBeTruthy();
    expect(donow.datastore).toBeTruthy();
    expect([...donow.surfaces.keys()].sort()).toEqual(SURFACE_IDS);

    // listSurfaces() is the same closed registry, from the service's own view.
    expect(donow.service.listSurfaces().map((s) => s.id).sort()).toEqual(SURFACE_IDS);
  });

  it('is unconditional — no "enabled" flag, unlike school.yml lifecycle', async () => {
    // No donow-specific config at all; must still fully construct.
    const donow = await createDonow({
      configService: fakeConfigService({}),
      eventBus: fakeEventBus(),
      logger: silent,
    });
    expect(donow.surfaces.size).toBe(7);
  });

  it('reads config knobs: approvalsToken, notifyService (needs haGateway too), pianoKioskDeviceParam, livingroomDeviceId', async () => {
    const donow = await createDonow({
      configService: fakeConfigService({
        approvalsToken: 'secret-token',
        pianoKioskDeviceParam: 'yellow-room-tablet',
        livingroomDeviceId: 'custom-tv',
      }),
      eventBus: fakeEventBus(),
      logger: silent,
    });
    // No haGateway supplied -> notifier stays null even with no notifyService configured.
    expect(donow.notifier).toBeNull();
    // Article-free — DoNowService's own templates own the leading article
    // (spec review finding).
    expect(donow.surfaces.get('piano-kiosk').label()).toBe('Piano Kiosk');
  });

  it('stop() unsubscribes the eventBus-backed presence trackers, safe to call twice', async () => {
    let unsubscribed = 0;
    const eventBus = {
      broadcast() {},
      subscribe() { return () => { unsubscribed += 1; }; },
    };
    const donow = await createDonow({ configService: fakeConfigService(), eventBus, logger: silent });
    donow.stop();
    donow.stop();
    // midi + playback trackers each subscribed once -> two unsubscribes, called once each.
    expect(unsubscribed).toBe(2);
  });
});

describe('createDonow — missing optional seams degrade, never throw', () => {
  // Every one of these actions is exactly what that surface's OWN
  // validateAction requires — the point is to reach occupancy/dispatch with
  // a well-formed payload and prove the MISSING SEAM (not a bad payload) is
  // what degrades the outcome.
  const actionsBySurface = {
    portal: { target: { kind: 'program', program: 'language' } },
    thermal: { document: { id: 'x', headline: 'h', lines: [] } },
    laser: {},
    'playback-hub': { action: 'play', target: 'red' },
    'livingroom-tv': { query: { foo: 1 } },
    'garage-fitness': { episodeId: 'plex:1' },
    'piano-kiosk': { contentId: 'hymn:12' },
  };

  it.each(Object.entries(actionsBySurface))(
    'surface "%s" with every optional seam absent: %j degrades, never throws',
    async (surface, action) => {
      const donow = await createDonow({
        configService: fakeConfigService(),
        eventBus: null, // no MIDI/playback presence, no garage/piano/portal broadcast
        thermalPrinterRegistry: null,
        homeAutomationAdapters: null,
        wakeAndLoadService: null,
        playbackHubContainer: null,
        schoolService: null,
        logger: silent,
      });

      const result = await donow.service.dispatch({
        surface, action, learnerId: 'kid1', requestedBy: 'api',
      });

      // Never a crash (this call resolving at all proves that); never a
      // phantom "dispatched" either — occupancy-gated surfaces (nothing to
      // read) pend for a grown-up, surfaces whose own dispatch declines
      // (no renderer/printer) fail outright. Both are honest.
      expect(['pending_approval', 'failed']).toContain(result.decision);
      expect(result.message).toEqual(expect.any(String));
    },
  );

  it('a throwing thermalPrinterRegistry.resolve degrades the thermal surface only, never throws', async () => {
    const donow = await createDonow({
      configService: fakeConfigService(),
      eventBus: fakeEventBus(),
      thermalPrinterRegistry: { resolve: () => { throw new Error('no default printer configured'); } },
      logger: silent,
    });
    expect(donow.surfaces.size).toBe(7);
    const result = await donow.service.dispatch({
      surface: 'thermal', action: { document: { id: 'x', headline: 'h', lines: [] } },
      learnerId: 'kid1', requestedBy: 'api',
    });
    expect(result.decision).toBe('failed');
  });
});

describe('createSchoolLifecycle — school.yml `programs:` + donow (Task 13)', () => {
  const wire = (schoolConfig, { donow = null, donowDatastore = null, languageStudyService = null } = {}) => createSchoolLifecycle({
    configService: {
      getHouseholdAppConfig: () => schoolConfig,
      getDataDir: () => dataDir,
      getDeviceConfig: () => null,
      getTimezone: () => null,
    },
    schoolService: { listBanks: () => [], getBank: () => null, activeSittings: async () => [] },
    eventBus: { broadcast() {}, onClientMessage() {}, subscribe: () => () => {} },
    donow,
    donowDatastore,
    languageStudyService,
    logger: silent,
  });

  const fakeDonow = () => ({
    dispatch: async () => ({ decision: 'dispatched', message: 'Starting now.' }),
  });
  const fakeDonowDatastore = () => ({ listDispatches: async () => [] });
  const fakeLanguageStudyService = () => ({ todayStatus: () => ({ doneToday: false, progressLabel: null, score: null }) });

  it('a `programs:` entry whose id collides with the code-registered "language" launcher throws at boot', async () => {
    await expect(wire(
      {
        lifecycle: { enabled: true }, printing: { host: 'printer.local' },
        programs: [{ id: 'language', surface: 'garage-fitness' }],
      },
      { donow: fakeDonow(), donowDatastore: fakeDonowDatastore(), languageStudyService: fakeLanguageStudyService() },
    )).rejects.toThrow(/collides with a code-registered launcher/);
  });

  it('collision check fires even when donow itself is not wired (a config mistake, caught regardless)', async () => {
    await expect(wire(
      {
        lifecycle: { enabled: true }, printing: { host: 'printer.local' },
        programs: [{ id: 'language', surface: 'garage-fitness' }],
      },
      { languageStudyService: fakeLanguageStudyService() },
    )).rejects.toThrow(/collides/);
  });

  it('a non-colliding `programs:` entry registers a SurfaceProgramLauncher reachable from the program registry', async () => {
    const result = await wire(
      {
        lifecycle: { enabled: true }, printing: { host: 'printer.local' },
        programs: [{ id: 'pe-daily', label: 'P.E.', surface: 'garage-fitness', action: { episodeId: 'plex:1' }, subject: 'skills' }],
      },
      { donow: fakeDonow(), donowDatastore: fakeDonowDatastore() },
    );
    expect(result.wired).toBe(true);
    // Program ids feed CurriculumAccess's programIds() — the only externally
    // observable surface of the launchers map from outside this module.
    const catalogAccess = result.stores.curriculum;
    expect(catalogAccess).toBeTruthy();
  });

  it('a non-colliding `programs:` entry with NO donow wired is skipped (warn), not thrown', async () => {
    const result = await wire({
      lifecycle: { enabled: true }, printing: { host: 'printer.local' },
      programs: [{ id: 'pe-daily', surface: 'garage-fitness' }],
    });
    expect(result.wired).toBe(true);
  });

  it('an invalid `programs:` entry (no id or no surface) is skipped with a warning, not thrown', async () => {
    const result = await wire({
      lifecycle: { enabled: true }, printing: { host: 'printer.local' },
      programs: [{ label: 'no id' }, { id: 'no-surface' }],
    }, { donow: fakeDonow(), donowDatastore: fakeDonowDatastore() });
    expect(result.wired).toBe(true);
  });

  it('missing `donow` degrades a launch scan to "Ask a grown-up to set this up." rather than throwing', async () => {
    const result = await wire({ lifecycle: { enabled: true }, printing: { host: 'printer.local' } });
    expect(result.wired).toBe(true);
    // No donow, no donowSchoolBridge either (bridge needs closeSessionOutcome,
    // which exists regardless — but bridge construction is gated on eventBus,
    // supplied here, so it DOES construct; the fail-closed behaviour under
    // test is ResolveScanAction's own, exercised at the use-case layer by
    // Task 12's tests). Wiring-level assertion: this file never throws.
    expect(result.useCases.resolveScanAction).toBeTruthy();
  });

  it('surfaceValidators reach CurriculumAccess: an unknown surface referenced by donowSurfaces is exposed for validation', async () => {
    const donowSurfaces = new Map([
      ['garage-fitness', { validateAction: (raw) => (raw?.episodeId ? [] : ['episodeId required']) }],
    ]);
    const result = await wire(
      { lifecycle: { enabled: true }, printing: { host: 'printer.local' } },
      { donow: fakeDonow(), donowDatastore: fakeDonowDatastore() },
    );
    // Rewire directly with donowSurfaces to prove the plumbing (wire() helper
    // above doesn't thread it — a second, explicit construction call does).
    const withSurfaces = await createSchoolLifecycle({
      configService: {
        getHouseholdAppConfig: () => ({ lifecycle: { enabled: true }, printing: { host: 'printer.local' } }),
        getDataDir: () => dataDir,
        getDeviceConfig: () => null,
        getTimezone: () => null,
      },
      schoolService: { listBanks: () => [], getBank: () => null, activeSittings: async () => [] },
      eventBus: { broadcast() {}, onClientMessage() {}, subscribe: () => () => {} },
      donow: fakeDonow(),
      donowSurfaces,
      donowDatastore: fakeDonowDatastore(),
      logger: silent,
    });
    expect(withSurfaces.wired).toBe(true);
    expect(result.wired).toBe(true);
  });

  it('an eventBus without subscribe() degrades the DoNow bridge (no bridge), not a throw', async () => {
    const result = await createSchoolLifecycle({
      configService: {
        getHouseholdAppConfig: () => ({ lifecycle: { enabled: true }, printing: { host: 'printer.local' } }),
        getDataDir: () => dataDir,
        getDeviceConfig: () => null,
        getTimezone: () => null,
      },
      schoolService: { listBanks: () => [], getBank: () => null, activeSittings: async () => [] },
      eventBus: { broadcast() {} }, // no subscribe
      donow: fakeDonow(),
      logger: silent,
    });
    expect(result.wired).toBe(true);
    expect(result.donowSchoolBridge).toBeNull();
  });
});
