/**
 * The School physical-console lifecycle harness.
 *
 * IT BOOTS THE PRODUCTION COMPOSITION. This file calls
 * `createSchoolLifecycle(...)` — the exact function `app.mjs` calls — on a temp
 * data dir with `virtualDevices: true`, and drives the graph that comes back.
 * It constructs no store, no renderer and no use case of its own. Everything a
 * test touches is the object the house would be running.
 *
 * WHY THAT IS THE WHOLE POINT. The harness used to hand-assemble eight
 * datastores, both renderers and all ten use cases in parallel with the
 * composition root. Every "harness green, production broken" defect in this
 * build came out of that gap: the missing asset resolver, the result receipt
 * that was never printed on close-out, and two barcodes that scanned to
 * nothing. The harness was testing one system while the console shipped
 * another. Now a wiring mistake in `5_composition/modules/schoolLifecycle.mjs`
 * is a failing test by construction.
 *
 * WHAT IS STILL SUPPLIED FROM OUTSIDE, and why each one is legitimate:
 *
 *   configService, userService  — system-layer inputs. The real ones read the
 *                                 house's YAML; these read the temp dir.
 *   schoolService, economyService — collaborators `app.mjs` also builds outside
 *                                 the lifecycle and passes in. Same arguments,
 *                                 same order, one wrapper that COUNTS payouts
 *                                 without changing any.
 *   eventBus                    — the house bus. `broadcast` is what the relay
 *                                 uses; `subscribe` is this harness standing in
 *                                 for app.mjs's relay branch, which it copies.
 *   clock, rng                  — determinism controls, now first-class
 *                                 parameters of the composition itself.
 *
 * The only test-only object built here is `receiptCanvasRenderer`: a SECOND
 * instance of the same canvas renderer the composition builds for itself
 * (`receiptPngRenderer`), used by `probeReceiptRendering` below to draw a
 * document without going through a live scan. The composition's OWN instance
 * is what actually reaches paper now — every scan-triggered receipt this
 * console prints is a raster PNG rasterized to a single ESC/POS image item,
 * with a real scannable QR baked into the pixels — so `barcodesInLastReceipt`
 * below reads the captured job's `codes` field (the raster renderer's own
 * account of what it drew) rather than filtering `items` by type, which would
 * find nothing: a raster job has no `qrcode` item, only pixels.
 *
 * WHAT A TEST ASSERTS ON. Observable artifacts only: the transcript off the
 * receipt roll, the PDF bytes in the tray, the form map that was stored, the
 * event log on disk, the coin ledger. A use case that returns a tidy object
 * while printing paper a child cannot act on has failed, and only
 * artifact-level assertions can see that.
 *
 * A KNOWN PRODUCTION GAP, stated rather than papered over: nothing in the
 * composition subscribes a playback-completion signal to
 * `RecordMediaCompletion`. `playToEnd()` therefore stops the virtual player and
 * then calls the use case off the graph directly. When that correlation is
 * wired, this method should shrink to the stop alone.
 *
 * @module tests/_lib/school/lifecycleHarness
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { createSchoolLifecycle } from '#composition/modules/schoolLifecycle.mjs';
import { createDonow } from '#composition/modules/donow.mjs';
import { YamlSchoolDatastore } from '#adapters/persistence/yaml/YamlSchoolDatastore.mjs';
import { YamlEconomyDatastore } from '#adapters/persistence/yaml/YamlEconomyDatastore.mjs';
import { SchoolService } from '#apps/school/SchoolService.mjs';
import { EconomyService } from '#apps/economy/EconomyService.mjs';
import { createDocumentReceiptRenderer } from '#rendering/school/documents/DocumentReceiptRenderer.mjs';
import { mintToken } from '#domains/school/sessions/tokens.mjs';
import { reduceSession } from '#domains/school/sessions/sessionEvents.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const FIXTURE_DIR = path.join(REPO_ROOT, 'tests', '_fixtures', 'school', 'curriculum');
/** The one committed asset the fixture worksheet references. */
const STRIPS_SVG_FILE = path.join(
  REPO_ROOT, 'tests', 'isolated', 'rendering', 'school', 'golden', 'corpus', 'fraction-strips.svg',
);

export const MEDIA_UNIT = 'math-fractions.01';
export const WORKSHEET_UNIT = 'math-fractions.02';
export const OMR_UNIT = 'math-fractions.03';
export const MIXED_UNIT = 'math-fractions.04';
export const COURSE_ID = 'math-fractions';

export const DEFAULT_LEARNER = 'kid1';
export const DEFAULT_GROWNUP = 'grownup1';

const HOUR_MS = 3_600_000;
const SCAN_TOPIC = 'barcode-relay';
const silent = { info() {}, warn() {}, error() {}, debug() {} };

// ---------------------------------------------------------------------------
// small deterministic primitives
// ---------------------------------------------------------------------------

/** A clock a test moves by hand. The composition reads this one. */
export function harnessClock(startIso = '2026-07-27T09:00:00.000Z') {
  let at = Date.parse(startIso);
  if (Number.isNaN(at)) throw new Error(`harnessClock: not an ISO timestamp: ${startIso}`);
  return {
    now: () => new Date(at),
    iso: () => new Date(at).toISOString(),
    epoch: () => at,
    advanceMs(ms) { at += ms; return this; },
    set(iso) { at = Date.parse(iso); return this; },
  };
}

/** Deterministic draws in [0,1): the same run always mints the same tokens. */
export function seededRng(seed = 20260727) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// temp data dir
// ---------------------------------------------------------------------------

/**
 * Lay the committed sample curriculum down where the real datastores look for
 * it. The fixtures are copied, never read in place, so a test that writes can
 * never touch the repo.
 */
function seedDataDir(dataDir) {
  // Production curriculum is filed as
  // `content/school/<subject>/<work>/<kind>`, while these compact fixtures stay
  // grouped by kind for reviewability. Re-file them here instead of teaching
  // the production adapter a test-only legacy layout.
  const schoolRoot = path.join(dataDir, 'content', 'school');
  const unitLocations = new Map();
  for (const file of fs.readdirSync(path.join(FIXTURE_DIR, 'units'))) {
    if (!/\.ya?ml$/i.test(file)) continue;
    const source = path.join(FIXTURE_DIR, 'units', file);
    const unit = yaml.load(fs.readFileSync(source, 'utf8'));
    const subject = unit?.subject;
    if (typeof subject !== 'string' || subject.length === 0) {
      throw new Error(`fixture unit ${file} has no subject`);
    }
    const work = unit.courseId || unit.program || unit.unitId.split('.')[0];
    fs.mkdirSync(path.join(schoolRoot, subject, work, 'units'), { recursive: true });
    fs.copyFileSync(source, path.join(schoolRoot, subject, work, 'units', file));
    if (unit.document) unitLocations.set(`documents:${unit.document}`, { subject, work });
    if (unit.media) unitLocations.set(`manifests:${unit.media}`, { subject, work });
  }
  for (const kind of ['documents', 'manifests']) {
    for (const file of fs.readdirSync(path.join(FIXTURE_DIR, kind))) {
      if (!/\.ya?ml$/i.test(file)) continue;
      const id = file.replace(/\.ya?ml$/i, '');
      const location = unitLocations.get(`${kind}:${id}`);
      if (!location) throw new Error(`fixture ${kind}/${file} is not referenced by a fixture unit`);
      const destination = path.join(schoolRoot, location.subject, location.work, kind);
      fs.mkdirSync(destination, { recursive: true });
      fs.copyFileSync(path.join(FIXTURE_DIR, kind, file), path.join(destination, file));
    }
  }
  // Bank IDs encode `<subject>/<work>/<rest>`; the adapter inserts the physical
  // `quizzes/` container. Preserve that same production locator contract in
  // the temporary graph.
  for (const file of fs.readdirSync(path.join(FIXTURE_DIR, 'banks'))) {
    if (!/\.ya?ml$/i.test(file)) continue;
    const source = path.join(FIXTURE_DIR, 'banks', file);
    const bank = yaml.load(fs.readFileSync(source, 'utf8'));
    const [subject, work, ...rest] = String(bank?.id ?? '').split('/');
    if (!subject || !work || rest.length === 0) {
      throw new Error(`fixture bank ${file} does not use <subject>/<work>/<rest> id`);
    }
    const destination = path.join(schoolRoot, subject, work, 'quizzes', ...rest);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, `${destination}.yml`);
  }
  // Artwork, at the path the COMPOSITION ROOT resolves refs against — nothing
  // here tells it where that is, which is the point: production shipped with no
  // resolver at all and nobody noticed, because the harness had its own.
  const strips = path.join(dataDir, 'content', 'assets', 'school', 'math');
  fs.mkdirSync(strips, { recursive: true });
  fs.copyFileSync(STRIPS_SVG_FILE, path.join(strips, 'fraction-strips.svg'));
}

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

/**
 * @param {object} [options]
 * @param {string} [options.startIso] - where the injected clock starts
 * @param {Array<{id:string,name:string,birthyear:number}>} [options.roster]
 * @param {boolean} [options.economyEnabled] - household coin switch (spec A5: off by default)
 * @param {number} [options.economyReward] - coins the configured earn action pays
 * @param {number} [options.graceSec] - media stall grace window
 * @param {number} [options.tokenTtlHours]
 * @param {object} [options.languageStudyService] - present makes the
 *   `language` program a live launcher (composition's own rule: no service,
 *   no launcher). A test that wants a `program:` unit to resolve (rather than
 *   be dropped as an unknown program at catalog load) passes one — see
 *   `LanguageStudyService` + a fake datastore, same arrangement as
 *   `programLaunchers.test.mjs`.
 * @param {Array<object>} [options.programs] - `school.yml`'s own `programs:`
 *   list (spec §6 "surface programs"), forwarded verbatim into the harness's
 *   `schoolConfig` — a test that wants a config-driven `SurfaceProgramLauncher`
 *   (e.g. `pe-daily`) to resolve passes `[{id, label, surface, action, subject}]`
 *   here, the same shape a household's real `school.yml` would carry.
 * @param {string} [options.donowNotifyService] - present makes DoNow's own
 *   `HaApprovalNotifier` a live notifier (Task 13's own rule: no
 *   `notifyService` config + no `haGateway`, no notifier). Wires a FAKE
 *   `haGateway` (`{callService}`) through `createDonow`'s real
 *   `CallHomeAssistantService`/`HaApprovalNotifier` chain — no new adapter
 *   double, the same production classes, with only the HA transport faked.
 *   Every call the notifier makes is recorded on the returned harness's
 *   `haGatewayCalls` array, so a test can assert "exactly one notification"
 *   without a bespoke notifier stub.
 * @returns {Promise<object>} the fluent driver
 */
export async function createLifecycleHarness({
  startIso = '2026-07-27T09:00:00.000Z',
  roster = [
    { id: DEFAULT_LEARNER, name: 'Test Learner', birthyear: 2016 },
    { id: DEFAULT_GROWNUP, name: 'Parent', birthyear: 1985 },
  ],
  economyEnabled = true,
  economyReward = 5,
  graceSec = 600,
  tokenTtlHours = 48,
  languageStudyService = null,
  programs = [],
  donowNotifyService = null,
  logger = silent,
} = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'school-lifecycle-e2e-'));
  seedDataDir(dataDir);

  const clock = harnessClock(startIso);
  const rng = seededRng();

  // --- what school.yml would say in a house running the console -------------
  const schoolConfig = {
    virtualDevices: true,
    // `programs` sits at the TOP level of the school config (schoolLifecycle.mjs
    // reads `cfg.programs`, not `cfg.lifecycle.programs`) — mirrors a real
    // `school.yml`'s own shape.
    programs,
    lifecycle: {
      enabled: true,
      tokenTtlHours,
      media: {
        graceSec,
        targets: [{ id: 'school-screen', label: 'the school screen', child_selectable: true }],
      },
      economy: { enabled: economyEnabled, action: 'school-unit-complete' },
    },
  };
  const economyConfig = {
    earn: {
      'school-unit-complete': { reward: economyReward, per: 'completion', daily_cap: 1000 },
    },
  };
  // Only meaningful when a test opts in (`donowNotifyService`) — `createDonow`
  // only builds a real `HaApprovalNotifier` when BOTH `notifyService` and a
  // `haGateway` are present, mirroring app.mjs's own household config shape.
  const donowConfig = donowNotifyService ? { notifyService: donowNotifyService } : {};

  // The fake HA transport `HaApprovalNotifier` sends through — every call
  // recorded here, so a test can assert "exactly one notification" against
  // the REAL notifier/CallHomeAssistantService chain rather than a bespoke
  // notifier double.
  const haGatewayCalls = [];
  const haGateway = {
    callService: async (domain, service, data) => {
      haGatewayCalls.push({ domain, service, data });
      return { ok: true };
    },
  };

  const configService = {
    getDataDir: () => dataDir,
    getHouseholdPath: (rel) => `${dataDir}/household/${rel}`,
    getUserDir: (id) => path.join(dataDir, 'users', String(id)),
    getUserProfile: (id) => roster.find((r) => r.id === id) ?? null,
    getHouseholdAppConfig: (_hid, app) => {
      if (app === 'school') return schoolConfig;
      if (app === 'economy') return economyConfig;
      if (app === 'donow') return donowConfig;
      return null;
    },
  };
  const userService = {
    getHouseholdRoster: () => roster.map((r) => ({ ...r })),
    getProfile: (id) => roster.find((r) => r.id === id) ?? null,
  };

  // --- the collaborators app.mjs builds OUTSIDE the lifecycle and passes in --
  const schoolDatastore = new YamlSchoolDatastore({ configService });
  const schoolService = new SchoolService({
    datastore: schoolDatastore, userService, logger, now: () => clock.epoch(),
  });
  // The boot pre-warm app.mjs does (`warmSchoolBanks`). `listBanks()` is a SYNC
  // read of a cache that fills asynchronously, and the lifecycle resolves every
  // unit's `bank:` ref against it — so without this the two units that name a
  // bank silently vanish from a child's agenda.
  await schoolService.warmBanks({ force: true });
  const economyDatastore = new YamlEconomyDatastore({ configService });
  const economy = new EconomyService({ datastore: economyDatastore, configService, logger });

  // Counting, not deciding: every call is forwarded to the real service
  // untouched. `economyCalls` is how a test says "and it was asked exactly once".
  const economyCalls = [];
  const countingEconomy = new Proxy(economy, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop !== 'earn' || typeof value !== 'function') {
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return async (userId, args) => {
        economyCalls.push({ userId, ...args });
        return target.earn(userId, args);
      };
    },
  });

  // --- the house bus --------------------------------------------------------
  const busEvents = [];
  const subscribers = new Map();
  const eventBus = {
    broadcast: (topic, payload) => {
      busEvents.push({ topic, payload });
      for (const fn of subscribers.get(topic) ?? []) fn(payload);
    },
    subscribe: (topic, fn) => {
      if (!subscribers.has(topic)) subscribers.set(topic, []);
      subscribers.get(topic).push(fn);
      return () => {};
    },
  };

  // Real, household-level DoNow (Task 13) — the SAME `createDonow` app.mjs
  // calls, constructed BEFORE the school lifecycle exactly like app.mjs now
  // orders it. `schoolActivity` (via `schoolService`) makes `portal`
  // occupancy-aware for real, and the shared `eventBus` is what a language
  // dispatch actually broadcasts on.
  const donow = await createDonow({
    configService,
    householdId: null,
    eventBus,
    schoolService,
    // Only wired when a test opts in — an absent `haGateway` is exactly the
    // "no HA gateway" degrade every other household config path already takes
    // (see `donow.mjs`'s own `donow.notifier.no-ha-gateway` warn branch).
    homeAutomationAdapters: donowNotifyService ? { haGateway } : null,
    // THE SAME clock the school lifecycle reads (below) — without this,
    // DoNowService stamps its dispatch-log rows against the REAL wall clock
    // (its own default) while `SurfaceProgramLauncher.status()` computes
    // "today"'s UTC day shard against THIS harness's simulated `startIso`,
    // so a program dispatched "today" in the simulated calendar could land
    // in a shard `status()` never reads back. One clock, one calendar.
    clock: () => clock.now(),
    logger,
  });

  // =========================================================================
  // THE PRODUCTION GRAPH
  // =========================================================================
  const lifecycle = await createSchoolLifecycle({
    configService,
    householdId: null,
    schoolService,
    economyService: countingEconomy,
    userService,
    eventBus,
    languageStudyService,
    donow: donow.service,
    donowSurfaces: donow.surfaces,
    donowDatastore: donow.datastore,
    clock: () => clock.now(),
    rng,
    logger,
  });
  if (!lifecycle.wired) {
    throw new Error(`the school composition refused to wire: ${lifecycle.reason}`);
  }

  const { useCases, stores, devices } = lifecycle;
  const laser = devices.laserPrinter;
  const thermal = devices.thermalPrinter;
  const { playback, omrReader: omr, scanner } = devices;
  for (const [name, device] of Object.entries({ laser, thermal, playback, omr, scanner })) {
    if (!device) throw new Error(`the composition wired no ${name} under virtualDevices: true`);
  }

  // --- the relay branch, copied from app.mjs --------------------------------
  // A scanner anywhere in the house offers every code to the console; the
  // console's own predicate decides whether it is one of ours. Both halves are
  // production's, so a change to either shows up here.
  let inFlight = Promise.resolve(null);
  let lastClaimed = null;
  eventBus.subscribe(SCAN_TOPIC, (relay) => {
    lastClaimed = lifecycle.handlesCode(relay.code);
    inFlight = lifecycle.handleScan({ code: relay.code, device: relay.device });
  });

  // --- the ORACLE (wired into nothing) --------------------------------------
  // Proves a document CAN be drawn on 58mm tape — it refuses `omr_response`,
  // for one. The console prints ESC/POS items instead, on purpose.
  const receiptCanvasRenderer = createDocumentReceiptRenderer();

  const bankReader = {
    getBank: (bankId) => { try { return schoolService.getBank(bankId); } catch { return null; } },
  };

  // Personal cards. An identify token never expires, which is what makes a card
  // the recovery path for every other failure.
  const cards = {};
  for (const learner of roster) {
    const record = mintToken({
      tokenClass: 'identify', subject: { learnerId: learner.id }, at: clock.iso(), rng,
    });
    // eslint-disable-next-line no-await-in-loop
    await stores.tokens.put(record);
    scanner.registerCard(learner.id, record.token);
    cards[learner.id] = record.token;
  }

  // -------------------------------------------------------------------------
  // driver
  // -------------------------------------------------------------------------

  let lastScan = null;
  let lastResult = null;
  let currentLearner = DEFAULT_LEARNER;

  const lastCapture = () => {
    const list = thermal.listReceipts();
    return list.length ? list[list.length - 1] : null;
  };

  // A raster receipt's `items` is a single `{type:'image'}` — its QR is
  // pixels the printer drew, not an item this harness can read a token out
  // of. `DocumentReceiptRasterRenderer` knows what it drew and hands that
  // over as the job's `codes` field (`VirtualThermalPrinterAdapter` passes it
  // through the capture untouched), so that is read FIRST. The `items` scan
  // stays as a fallback for a text-only job — no `receiptPngRenderer` built
  // (a missing `qrcode`/`canvas`/`resvg` dependency), or the raster path
  // itself fell back to the ESC/POS renderer — where `codes` is never set and
  // the school console's `symbology: 'QR'` still means `qrcode`, not
  // `barcode`; `barcode` stays in the filter only as a defensive regression
  // check, should the composition ever revert to Code128.
  const barcodesInLastReceipt = () => {
    const capture = lastCapture();
    if (capture?.codes) return capture.codes.map(({ token, label }) => ({ token, label }));
    return (capture?.items ?? [])
      .filter((item) => item.type === 'qrcode' || item.type === 'barcode')
      .map((item) => ({ token: String(item.content), label: String(item.label ?? '') }));
  };

  /** Every session this learner has, newest first, as derived facts. */
  const sessionRows = async (learnerId = currentLearner) => stores.sessions.listForLearner(learnerId);

  async function sessionIdFor(unitId, learnerId = currentLearner) {
    const rows = await sessionRows(learnerId);
    const matching = rows.filter((r) => r.unitId === unitId);
    if (!matching.length) return null;
    const open = matching.find((r) => !r.terminal);
    return (open ?? matching[0]).sessionId;
  }

  async function stateOf(sessionId) {
    return reduceSession(await stores.sessions.readEvents(sessionId));
  }

  /** The artifact this session last had printed. */
  async function lastArtifactId(sessionId) {
    return (await stateOf(sessionId)).issuedArtifacts.at(-1) ?? null;
  }

  const harness = {
    // --- plumbing a test may reach for --------------------------------------
    dataDir,
    clock,
    cards,
    /** The graph itself, for a test that wants to assert on the wiring. */
    lifecycle,
    /** The real household-level DoNow module this harness constructed. */
    donow,
    devices: { laser, thermal, playback, omr, scanner },
    stores,
    useCases,
    renderers: lifecycle.renderers,
    economyCalls,
    busEvents,
    /** Every call DoNow's HA notifier made through the fake `haGateway` — see `donowNotifyService`. */
    haGatewayCalls,

    /** Did the console's OWN predicate claim the last scanned code? */
    consoleClaimedLastScan() { return lastClaimed; },

    /** Which learner the shorthand methods act for. */
    as(learnerId) { currentLearner = learnerId; return harness; },
    get learnerId() { return currentLearner; },

    // --- setup ---------------------------------------------------------------
    async assign({ learnerId = currentLearner, courses = [COURSE_ID], units = [] } = {}) {
      return stores.assignments.put({ learnerId, courses, units, updatedAt: clock.iso() });
    },

    // --- scanning ------------------------------------------------------------

    /** Scan a learner's personal card, through the relay's own broadcast path. */
    async scanCard(learnerId = currentLearner) {
      currentLearner = learnerId;
      scanner.scanCard(learnerId);
      lastScan = await inFlight;
      return lastScan;
    },

    /** Scan any code at all — garbage included; deciding it means nothing is the system's job. */
    async scan(code, opts = {}) {
      scanner.scan(code, opts);
      lastScan = await inFlight;
      return lastScan;
    },

    async scanToken(token, opts = {}) { return harness.scan(token, opts); },

    /**
     * Scan the action off the last receipt whose printed LABEL matches. This is
     * what a child does: they read the line, then wave the barcode beside it.
     */
    async scanTokenMatching(pattern) {
      const options = barcodesInLastReceipt();
      const hit = options.find(({ label }) => pattern.test(label));
      if (!hit) {
        throw new Error(
          `no scannable action on the last receipt matching ${pattern}. Printed actions: `
          + `${options.map((o) => JSON.stringify(o.label)).join(', ') || '(none)'}`,
        );
      }
      return harness.scan(hit.token);
    },

    // --- what came off the printers -----------------------------------------

    /** The plain text a child reads off the last receipt. */
    lastReceiptText() { return thermal.lastTranscript(); },
    receiptTexts() { return thermal.listReceipts().map((r) => r.transcript); },
    lastReceiptItems() { return lastCapture()?.items ?? []; },

    /** `[{ token, label }]` for every scannable action on the last receipt. */
    tokensInLastReceipt() { return barcodesInLastReceipt(); },

    /** Sidecars for everything that reached the paper tray, in order. */
    printedPdfs() { return laser.listJobs(); },
    async readPrintedPdf(jobId) { return laser.readJob(jobId); },
    async lastPrintedPdf() {
      const jobs = laser.listJobs();
      if (!jobs.length) return null;
      return laser.readJob(jobs[jobs.length - 1].jobId);
    },

    /** The stored form map for a session's most recent sheet. */
    async formMapFor(sessionId) {
      const artifactId = await lastArtifactId(sessionId);
      return artifactId ? stores.formMaps.get(artifactId) : null;
    },
    async lastFormMap(unitId = OMR_UNIT) {
      const sessionId = lastScan?.sessionId ?? await sessionIdFor(unitId);
      return sessionId ? harness.formMapFor(sessionId) : null;
    },

    /**
     * Draw a document on the REAL thermal canvas renderer. Nothing about an
     * item list proves a document can be put on tape — this does.
     */
    async probeReceiptRendering(document) {
      const canvas = await receiptCanvasRenderer.createCanvas(document, {});
      return { width: canvas.width, height: canvas.height, codes: canvas.codes };
    },

    // --- media ---------------------------------------------------------------

    /**
     * Play the current dispatch to the end and let the completion reach the
     * lifecycle. See the module header: the composition wires no subscriber for
     * this yet, so the use case is called off the graph directly.
     */
    async playToEnd({ sessionId = lastScan?.sessionId, dispatchId = null } = {}) {
      const id = dispatchId ?? lastScan?.effect?.dispatchId
        ?? playback.listDispatches().at(-1)?.dispatchId;
      if (!id) throw new Error('playToEnd: nothing has been dispatched');
      const record = playback.playToEnd(id);
      lastResult = await useCases.recordMediaCompletion.execute({
        sessionId, learnerId: currentLearner, dispatchId: record.dispatchId, verified: 'playhead',
      });
      return lastResult;
    },

    /** Stop mid-content: no completion signal at all, which is the stall path. */
    interruptPlayback({ dispatchId = null } = {}) {
      const id = dispatchId ?? lastScan?.effect?.dispatchId
        ?? playback.listDispatches().at(-1)?.dispatchId;
      if (!id) throw new Error('interruptPlayback: nothing has been dispatched');
      return playback.interrupt(id);
    },

    async checkStalled(sessionId) { return useCases.recordMediaCompletion.checkStalled({ sessionId }); },

    // --- paper in ------------------------------------------------------------

    /**
     * Feed a filled-in bubble sheet through the reader, against the REAL form
     * map the printer emitted, and submit what it read.
     *
     * @param {Record<string,string>} chosen - itemId → bubble letter (A, B, C…)
     */
    async omrSubmit(chosen = {}, { sessionId = null, ambiguous = [], blank = [], submittedBy = DEFAULT_GROWNUP } = {}) {
      const id = sessionId ?? lastScan?.sessionId ?? await sessionIdFor(OMR_UNIT);
      if (!id) throw new Error('omrSubmit: no session to submit against');
      const formMap = await harness.formMapFor(id);
      if (!formMap) throw new Error(`omrSubmit: no form map stored for session ${id}`);
      const sheet = omr.scanSheet({ formMap, chosen, ambiguous, blank });
      lastResult = await useCases.submitPaperWork.fromOmrSheet({ sessionId: id, sheet, submittedBy });
      return lastResult;
    },

    /**
     * Which BUBBLE a child fills to give the bank's correct answer, resolved
     * through the printed form map. The map records the choice text under each
     * bubble, so this is the same join the reader makes — no letters hardcoded
     * anywhere, which is what would hide a paper/grader drift.
     *
     * @param {object} args
     * @param {string} args.sessionId
     * @param {string} args.bankId
     * @param {string[]} [args.wrong] - itemIds to answer with a DIFFERENT bubble
     * @returns {Promise<Record<string,string>>} itemId → bubble letter
     */
    async correctBubbles({ sessionId, bankId, wrong = [] }) {
      const formMap = await harness.formMapFor(sessionId);
      if (!formMap) throw new Error(`correctBubbles: no form map stored for session ${sessionId}`);
      const bank = bankReader.getBank(bankId);
      if (!bank) throw new Error(`correctBubbles: no bank ${bankId}`);
      const wrongSet = new Set(wrong);
      const chosen = {};
      for (const item of bank.items) {
        const bubbles = formMap.marks.filter((m) => m.itemId === item.id);
        if (!bubbles.length) continue;
        const right = bubbles.find((m) => m.label === item.answer);
        if (!right) throw new Error(`correctBubbles: no bubble on the sheet carries ${item.id}'s answer ${item.answer}`);
        const pick = wrongSet.has(item.id) ? bubbles.find((m) => m.label !== item.answer) : right;
        chosen[item.id] = pick.choice;
      }
      return chosen;
    },

    /** Hand a written sheet in for a grown-up to mark. */
    async handIn({ sessionId = null, entries = {}, ambiguous = [], blank = [], submittedBy = DEFAULT_GROWNUP } = {}) {
      const id = sessionId ?? lastScan?.sessionId;
      if (!id) throw new Error('handIn: no session to submit against');
      lastResult = await useCases.submitPaperWork.execute({ sessionId: id, entries, ambiguous, blank, submittedBy });
      return lastResult;
    },

    /**
     * A grown-up marks the work. Hands it in first when it has not been handed
     * in — which is what actually happens with a written sheet: the parent picks
     * it up and marks it in one sitting.
     */
    async parentGrades(verdicts = {}, { sessionId = null, gradedBy = DEFAULT_GROWNUP } = {}) {
      const id = sessionId ?? lastScan?.sessionId;
      if (!id) throw new Error('parentGrades: no session to mark');
      const state = await stateOf(id);
      if (state.state === 'issued' || state.state === 'reprinted' || state.state === 'media_completed') {
        await useCases.submitPaperWork.execute({ sessionId: id, entries: {}, submittedBy: gradedBy });
      }
      lastResult = await useCases.gradeSubmission.execute({ sessionId: id, verdicts, gradedBy });
      return lastResult;
    },

    /** Machine-marked answers (the on-screen quiz, and the OMR feeder's output). */
    async grade({ sessionId = null, entries = {}, verdicts = {}, gradedBy = null } = {}) {
      const id = sessionId ?? lastScan?.sessionId;
      if (!id) throw new Error('grade: no session to mark');
      lastResult = await useCases.gradeSubmission.execute({ sessionId: id, entries, verdicts, gradedBy });
      return lastResult;
    },

    // --- settling ------------------------------------------------------------

    /**
     * Close a graded session out. The use case prints its own result receipt —
     * the harness used to do that here, which hid the fact that production
     * never did it at all.
     *
     * A sign-off names the grown-up making it: the use case checks the id
     * against the roster, so `signedOff: true` with nobody attached is refused.
     */
    async closeOutcome({ sessionId = null, signedOff = false, signedOffBy = DEFAULT_GROWNUP } = {}) {
      const id = sessionId ?? lastScan?.sessionId;
      if (!id) throw new Error('closeOutcome: no session to settle');
      lastResult = await useCases.closeSessionOutcome.execute({
        sessionId: id, signedOff, signedOffBy: signedOff ? signedOffBy : null,
      });
      return lastResult;
    },

    // --- reading the record --------------------------------------------------

    async sessionState(sessionId) { return stateOf(sessionId); },
    async sessionIdFor(unitId, learnerId = currentLearner) { return sessionIdFor(unitId, learnerId); },
    async sessionRows(learnerId = currentLearner) { return sessionRows(learnerId); },
    async sessionEvents(sessionId) { return stores.sessions.readEvents(sessionId); },
    async eventTypes(sessionId) { return (await stores.sessions.readEvents(sessionId)).map((e) => e.type); },
    async reviewItems(sessionId) { return stores.reviewQueue.listForSession(sessionId); },
    async pendingReview() { return stores.reviewQueue.listPending(); },

    async agenda(learnerId = currentLearner) {
      return useCases.buildAgenda.execute({
        learnerId, learnerName: userService.getProfile(learnerId)?.name ?? null,
      });
    },
    async plan(learnerId = currentLearner) { return (await harness.agenda(learnerId)).plan; },

    async coinsFor(learnerId = currentLearner) {
      return (await economy.getBalance(learnerId)).balance;
    },
    ledgerFor(learnerId = currentLearner) { return economyDatastore.readAllTransactions(learnerId); },
    attemptsFor(learnerId = currentLearner) { return schoolDatastore.readAllAttempts(learnerId); },

    get lastScan() { return lastScan; },
    get lastResult() { return lastResult; },

    // --- the world -----------------------------------------------------------

    advanceClock(ms) { clock.advanceMs(ms); return harness; },
    advanceHours(h) { clock.advanceMs(h * HOUR_MS); return harness; },
    advanceDays(d) { clock.advanceMs(d * 24 * HOUR_MS); return harness; },

    /** @param {'laser'|'thermal'} device @param {'offline'|'jam'|null} fault */
    setFault(device, fault) {
      if (device === 'laser') { laser.setFault(fault); return harness; }
      if (device === 'thermal') { thermal.setFault(fault); return harness; }
      throw new Error(`setFault: unknown device '${device}' (expected laser|thermal)`);
    },

    // --- composite journeys, for tests that need a unit already behind them ---

    /**
     * The whole of unit 01, the way a child does it: card, scan the offered
     * action, watch it, answer the on-screen quiz, settle.
     */
    async completeMediaUnit({ learnerId = currentLearner, answers = null } = {}) {
      currentLearner = learnerId;
      await harness.scanCard(learnerId);
      await harness.scanTokenMatching(/watch or listen/i);
      await harness.playToEnd();
      const sessionId = await sessionIdFor(MEDIA_UNIT, learnerId);
      const bank = bankReader.getBank('math/math-fractions/01-quiz');
      const entries = answers ?? Object.fromEntries(bank.items
        .filter((item) => item.type !== 'matching')
        .map((item) => [item.id, item.answer]));
      const matching = bank.items.filter((item) => item.type === 'matching');
      for (const item of matching) entries[item.id] = item.pairs.map((p) => ({ ...p }));
      await useCases.submitPaperWork.execute({ sessionId, entries, submittedBy: learnerId });
      await useCases.gradeSubmission.execute({ sessionId, entries });
      return harness.closeOutcome({ sessionId });
    },

    /** The whole of unit 02: print it, a grown-up marks it, settle. */
    async completeWorksheetUnit({ learnerId = currentLearner, verdicts = null } = {}) {
      currentLearner = learnerId;
      await harness.scanCard(learnerId);
      await harness.scanTokenMatching(/print your sheet/i);
      const sessionId = await sessionIdFor(WORKSHEET_UNIT, learnerId);
      const marks = verdicts ?? Object.fromEntries(
        ['u2-q1', 'u2-q2', 'u2-q3', 'u2-q4', 'u2-q5', 'u2-q6'].map((id) => [id, 'correct']),
      );
      await harness.parentGrades(marks, { sessionId });
      return harness.closeOutcome({ sessionId });
    },

    dispose() {
      donow.stop();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };

  return harness;
}

/** Read a fixture bank straight off disk, for a test that needs the right answers. */
export function fixtureBank(id) {
  const directory = path.join(FIXTURE_DIR, 'banks');
  for (const file of fs.readdirSync(directory).filter((name) => /\.ya?ml$/i.test(name))) {
    const bank = yaml.load(fs.readFileSync(path.join(directory, file), 'utf8'));
    if (bank?.id === id) return bank;
  }
  throw new Error(`fixture bank not found: ${id}`);
}

export default createLifecycleHarness;
