/**
 * The School physical-console lifecycle harness.
 *
 * Everything else in this subsystem is tested in isolation, against doubles.
 * That proves each part works alone. It does not prove a child can do a piece of
 * schoolwork. This harness builds the WHOLE object graph — real use cases, real
 * domain, real renderers (MathJax + pdfkit), real YAML persistence on a temp
 * data dir — and swaps in the virtual devices for the four things that are
 * physical: the laser printer, the receipt printer, the playback target, and the
 * mark reader. Nothing else is faked.
 *
 * WHAT A TEST ASSERTS ON. Observable artifacts only: the transcript of what came
 * off the receipt roll, the PDF bytes that landed in the tray, the form map that
 * was stored, the event log on disk, the coin ledger. A use case that returns a
 * tidy object while printing a piece of paper a child cannot act on has failed,
 * and only artifact-level assertions can see that.
 *
 * THE CLOCK IS INJECTED THROUGHOUT. Nothing in the lifecycle path reads
 * `Date.now()`, so grace windows, token expiry and UTC day boundaries are
 * things a test states rather than waits for.
 *
 * TWO ADAPTERS LIVE HERE THAT PRODUCTION STILL NEEDS (Phase F7 composition):
 *
 *  1. `EscPosReceiptRenderer` — `ReceiptPrinting` takes an `IReceiptRenderer`
 *     that returns the ESC/POS `{ items, footer }` job the thermal adapter
 *     accepts. No implementation of that port exists in `backend/`. Without one
 *     the console prints nothing at all, so the harness supplies a faithful one
 *     (text + labelled barcode per block) rather than pretending receipts work.
 *  2. `PdfDocumentRendererAdapter` — `IssueDocument` calls
 *     `renderer.render(document, { tokens, variant, bank, ... })`;
 *     `createDocumentPdfRenderer()` returns a `render(document, { tokens, bank,
 *     studentName })` with no `variant` parameter at all. Something has to carry
 *     the session's retry variant onto the document. That something does not
 *     exist in `backend/` either.
 *
 * Both are flagged rather than hidden: they are the seam the composition root
 * has to close, and the harness is where their absence shows up first.
 *
 * @module tests/_lib/school/lifecycleHarness
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { YamlCurriculumDatastore } from '#adapters/persistence/yaml/YamlCurriculumDatastore.mjs';
import { YamlWorkSessionDatastore } from '#adapters/persistence/yaml/YamlWorkSessionDatastore.mjs';
import { YamlTokenRegistry } from '#adapters/persistence/yaml/YamlTokenRegistry.mjs';
import { YamlFormMapStore } from '#adapters/persistence/yaml/YamlFormMapStore.mjs';
import { YamlAssignmentStore } from '#adapters/persistence/yaml/YamlAssignmentStore.mjs';
import { YamlReviewQueue } from '#adapters/persistence/yaml/YamlReviewQueue.mjs';
import { YamlSchoolDatastore } from '#adapters/persistence/yaml/YamlSchoolDatastore.mjs';
import { YamlEconomyDatastore } from '#adapters/persistence/yaml/YamlEconomyDatastore.mjs';

import { VirtualLaserPrinterAdapter } from '#adapters/hardware/laser-printer/VirtualLaserPrinterAdapter.mjs';
import { VirtualThermalPrinterAdapter } from '#adapters/hardware/thermal-printer/VirtualThermalPrinterAdapter.mjs';
import { VirtualPlaybackAdapter } from '#adapters/hardware/playback/VirtualPlaybackAdapter.mjs';
import { VirtualScannerAdapter } from '#adapters/hardware/scanner/VirtualScannerAdapter.mjs';
import { VirtualOmrReader } from '#adapters/hardware/omr/VirtualOmrReader.mjs';

import { createDocumentPdfRenderer } from '#rendering/school/documents/DocumentPdfRenderer.mjs';
import { createDocumentReceiptRenderer } from '#rendering/school/documents/DocumentReceiptRenderer.mjs';

import { CurriculumAccess } from '#apps/school/CurriculumAccess.mjs';
import { ReceiptPrinting } from '#apps/school/ReceiptPrinting.mjs';
import { SchoolService } from '#apps/school/SchoolService.mjs';
import { EconomyService } from '#apps/economy/EconomyService.mjs';
import { IDocumentRenderer, IReceiptRenderer } from '#apps/school/ports/IDocumentRenderer.mjs';

import { BuildAgenda } from '#apps/school/usecases/BuildAgenda.mjs';
import { ResolvePersonalCard } from '#apps/school/usecases/ResolvePersonalCard.mjs';
import { ResolveScanAction } from '#apps/school/usecases/ResolveScanAction.mjs';
import { IssueDocument } from '#apps/school/usecases/IssueDocument.mjs';
import { DispatchMedia } from '#apps/school/usecases/DispatchMedia.mjs';
import { RecordMediaCompletion } from '#apps/school/usecases/RecordMediaCompletion.mjs';
import { SubmitPaperWork } from '#apps/school/usecases/SubmitPaperWork.mjs';
import { GradeSubmission } from '#apps/school/usecases/GradeSubmission.mjs';
import { CloseSessionOutcome } from '#apps/school/usecases/CloseSessionOutcome.mjs';
import { OpenRemediation } from '#apps/school/usecases/OpenRemediation.mjs';

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
const silent = { info() {}, warn() {}, error() {}, debug() {} };

// ---------------------------------------------------------------------------
// small deterministic primitives
// ---------------------------------------------------------------------------

/** A clock a test moves by hand. Every collaborator below reads this one. */
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

function sequentialIds(prefix) {
  let n = 0;
  return () => `${prefix}${String(++n).padStart(3, '0')}`;
}

// ---------------------------------------------------------------------------
// the two composition adapters production still owes (see the header)
// ---------------------------------------------------------------------------

/**
 * Receipt document → the ESC/POS item list `ThermalPrinterAdapter.print()`
 * accepts. A `scan_action` prints its LABEL and then its opaque code as a
 * barcode, in that order, because a page of unlabelled stripes is not something
 * a child can act on.
 */
export class EscPosReceiptRenderer extends IReceiptRenderer {
  render(document, { tokens = null } = {}) {
    const items = [];
    for (const block of document.blocks ?? []) {
      if (block.type === 'rich_text') {
        for (const raw of String(block.md ?? '').split('\n')) {
          const line = raw.trim();
          if (!line) { items.push({ type: 'space', lines: 1 }); continue; }
          const heading = line.startsWith('#');
          items.push({
            type: 'text',
            content: heading ? line.replace(/^#+\s*/, '') : line,
            align: heading ? 'center' : 'left',
            ...(heading ? { style: { bold: true }, size: { width: 2, height: 2 } } : {}),
          });
        }
        continue;
      }
      if (block.type === 'scan_action' || block.type === 'media_action') {
        const code = tokens?.[block.action] ?? block.action;
        items.push({ type: 'text', content: block.label, align: 'left' });
        items.push({ type: 'barcode', content: code, label: block.label, symbology: 'CODE128' });
        continue;
      }
      // Refused by name rather than dropped: a block that silently vanishes is a
      // receipt that silently loses the child's next move.
      throw new Error(`EscPosReceiptRenderer: block type '${block.type}' has no receipt rendering`);
    }
    items.push({ type: 'line', content: '-', width: 32 });
    return { items, footer: { paddingLines: 3, autoCut: true } };
  }
}

/**
 * `IDocumentRenderer` over `createDocumentPdfRenderer()`.
 *
 * The one decision it makes is carrying `opts.variant` onto the document, so the
 * artifact and its form map record WHICH form of the sheet was handed over. The
 * underlying renderer has no variant parameter and generates no equivalent
 * problems, so a retry currently reprints the same questions under a new
 * variant number — recorded here, and reported by the e2e suite.
 */
export class PdfDocumentRendererAdapter extends IDocumentRenderer {
  #inner;

  constructor(inner) {
    super();
    this.#inner = inner;
    this.calls = [];
  }

  async render(document, opts = {}) {
    const variant = Number.isInteger(opts.variant) ? opts.variant : (document.variant ?? 0);
    const doc = variant === (document.variant ?? 0) ? document : { ...document, variant };
    this.calls.push({ documentId: document.id, variant, tokens: opts.tokens ?? {} });
    return this.#inner.render(doc, {
      tokens: opts.tokens ?? null,
      bank: opts.bank ?? null,
      studentName: opts.studentName ?? null,
    });
  }
}

// ---------------------------------------------------------------------------
// temp data dir
// ---------------------------------------------------------------------------

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

/**
 * Lay the committed sample curriculum down where the real datastores look for
 * it. The fixtures are copied, never read in place, so a test that writes can
 * never touch the repo.
 */
function seedDataDir(dataDir) {
  const curriculum = path.join(dataDir, 'content', 'school', 'curriculum');
  for (const kind of ['units', 'documents', 'manifests']) {
    copyTree(path.join(FIXTURE_DIR, kind), path.join(curriculum, kind));
  }
  // Banks live in the EXISTING quiz tree, because paper is graded by the same
  // engine and the same banks the on-screen quiz uses (spec §7.1).
  copyTree(path.join(FIXTURE_DIR, 'banks'), path.join(dataDir, 'content', 'quizzes'));
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
 * @returns {Promise<object>} the fluent driver
 */
export async function createLifecycleHarness({
  startIso = '2026-07-27T09:00:00.000Z',
  roster = [
    { id: DEFAULT_LEARNER, name: 'learner-two', birthyear: 2016 },
    { id: DEFAULT_GROWNUP, name: 'Parent', birthyear: 1985 },
  ],
  economyEnabled = true,
  economyReward = 5,
  graceSec = 600,
  tokenTtlHours = 48,
  logger = silent,
} = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'school-lifecycle-e2e-'));
  seedDataDir(dataDir);

  const clock = harnessClock(startIso);
  const rng = seededRng();
  const now = () => clock.now();

  const economyConfig = {
    earn: {
      'school-unit-complete': { reward: economyReward, per: 'completion', daily_cap: 1000 },
    },
  };

  const configService = {
    getDataDir: () => dataDir,
    getUserDir: (id) => path.join(dataDir, 'users', String(id)),
    getUserProfile: (id) => roster.find((r) => r.id === id) ?? null,
    getHouseholdAppConfig: (_hid, app) => (app === 'economy' ? economyConfig : null),
  };
  const userService = {
    getHouseholdRoster: () => roster.map((r) => ({ ...r })),
    getProfile: (id) => roster.find((r) => r.id === id) ?? null,
  };

  // --- persistence (real) --------------------------------------------------
  const curriculumStore = new YamlCurriculumDatastore({ configService });
  const sessions = new YamlWorkSessionDatastore({ configService });
  const tokens = new YamlTokenRegistry({ configService });
  const formMaps = new YamlFormMapStore({ configService });
  const assignments = new YamlAssignmentStore({ configService });
  const reviewQueue = new YamlReviewQueue({ configService });
  const schoolDatastore = new YamlSchoolDatastore({ configService });
  const economyDatastore = new YamlEconomyDatastore({ configService });

  // --- hardware (virtual) --------------------------------------------------
  const busEvents = [];
  const eventBus = { broadcast: (topic, payload) => { busEvents.push({ topic, payload }); } };

  const laser = new VirtualLaserPrinterAdapter({
    captureDir: path.join(dataDir, 'captures', 'laser'), logger, clock: now,
  });
  const thermal = new VirtualThermalPrinterAdapter(
    { captureDir: path.join(dataDir, 'captures', 'thermal') },
    { logger, clock: now },
  );
  const playback = new VirtualPlaybackAdapter({
    eventBus, targets: ['school-screen'], logger, clock: now,
  });
  const omr = new VirtualOmrReader({ eventBus, readerId: 'virtual-omr', logger });

  // --- rendering (real) ----------------------------------------------------
  const stripsSvg = fs.readFileSync(STRIPS_SVG_FILE, 'utf8');
  const resolveAsset = (ref) => (ref === 'school/math/fraction-strips'
    ? { svg: stripsSvg, widthPt: 400, heightPt: 120 }
    : null);
  const pdfRenderer = new PdfDocumentRendererAdapter(createDocumentPdfRenderer({ resolveAsset }));
  const receiptRenderer = new EscPosReceiptRenderer();
  // The real thermal renderer, used as a PROBE: it is what proves a receipt
  // document can actually be drawn on tape (it refuses `omr_response`, for one).
  const receiptCanvasRenderer = createDocumentReceiptRenderer();

  // --- application (real) --------------------------------------------------
  const curriculum = new CurriculumAccess({
    catalog: curriculumStore,
    bankIds: () => schoolDatastore.listBankIds(),
    ttlMs: 0,
    clock: () => clock.epoch(),
    logger,
  });

  const grader = new SchoolService({
    datastore: schoolDatastore, userService, logger, now: () => clock.epoch(),
  });
  const bankReader = { getBank: (bankId) => { try { return grader.getBank(bankId); } catch { return null; } } };

  const economy = new EconomyService({ datastore: economyDatastore, configService, logger });
  const economyCalls = [];
  const countingEconomy = {
    earn: async (userId, args) => {
      economyCalls.push({ userId, ...args });
      return economy.earn(userId, args);
    },
  };

  const receipts = new ReceiptPrinting({ renderer: receiptRenderer, printer: thermal, logger });

  const buildAgenda = new BuildAgenda({
    curriculum, assignments, sessions, tokens,
    clock: now, rng, newSessionId: sequentialIds('ses_'), tokenTtlHours, logger,
  });
  const issueDocument = new IssueDocument({
    curriculum, sessions, tokens, renderer: pdfRenderer, printer: laser, formMaps, bankReader,
    clock: now, rng, newArtifactId: sequentialIds('art_'), logger,
  });
  const dispatchMedia = new DispatchMedia({
    curriculum, sessions, playback,
    targets: [{ id: 'school-screen', label: 'the school screen', child_selectable: true }],
    clock: now, logger,
  });
  const recordMediaCompletion = new RecordMediaCompletion({ curriculum, sessions, clock: now, graceSec, logger });
  const submitPaperWork = new SubmitPaperWork({ curriculum, sessions, formMaps, reviewQueue, bankReader, clock: now, logger });
  const gradeSubmission = new GradeSubmission({ curriculum, sessions, reviewQueue, grader, bankReader, clock: now, logger });
  const closeSessionOutcome = new CloseSessionOutcome({
    curriculum, sessions, tokens, assignments, receipts,
    economy: countingEconomy, economyAction: 'school-unit-complete', economyEnabled,
    clock: now, rng, logger,
  });
  const openRemediation = new OpenRemediation({
    curriculum, sessions, clock: now, newSessionId: sequentialIds('rem_'), logger,
  });
  const resolvePersonalCard = new ResolvePersonalCard({
    buildAgenda, receipts, roster: { displayName: (id) => userService.getProfile(id)?.name ?? null }, logger,
  });
  const resolveScanAction = new ResolveScanAction({
    tokens, sessions, curriculum, resolvePersonalCard, issueDocument,
    dispatchMedia, openRemediation, receipts, clock: now, logger,
  });

  // --- the scanner routes into the one entry point -------------------------
  let inFlight = Promise.resolve(null);
  const scanner = new VirtualScannerAdapter({
    eventBus,
    onScan: (payload) => {
      inFlight = resolveScanAction.execute({ code: payload.code, device: payload.device });
    },
    defaultDevice: 'school-desk',
    logger,
    clock: now,
  });

  // Personal cards. An identify token never expires, which is what makes a card
  // the recovery path for every other failure.
  const cards = {};
  for (const learner of roster) {
    const record = mintToken({
      tokenClass: 'identify', subject: { learnerId: learner.id }, at: clock.iso(), rng,
    });
    // eslint-disable-next-line no-await-in-loop
    await tokens.put(record);
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

  const barcodesInLastReceipt = () => (lastCapture()?.items ?? [])
    .filter((item) => item.type === 'barcode')
    .map((item) => ({ token: String(item.content), label: String(item.label ?? '') }));

  /** Every session this learner has, newest first, as derived facts. */
  const sessionRows = async (learnerId = currentLearner) => sessions.listForLearner(learnerId);

  async function sessionIdFor(unitId, learnerId = currentLearner) {
    const rows = await sessionRows(learnerId);
    const matching = rows.filter((r) => r.unitId === unitId);
    if (!matching.length) return null;
    const open = matching.find((r) => !r.terminal);
    return (open ?? matching[0]).sessionId;
  }

  async function stateOf(sessionId) {
    return reduceSession(await sessions.readEvents(sessionId));
  }

  /** The artifact this session last had printed, and the form map behind it. */
  async function lastArtifactId(sessionId) {
    return (await stateOf(sessionId)).issuedArtifacts.at(-1) ?? null;
  }

  const harness = {
    // --- plumbing a test may reach for --------------------------------------
    dataDir,
    clock,
    cards,
    devices: { laser, thermal, playback, omr, scanner },
    stores: { sessions, tokens, formMaps, assignments, reviewQueue, schoolDatastore, curriculum },
    useCases: {
      buildAgenda, issueDocument, dispatchMedia, recordMediaCompletion,
      submitPaperWork, gradeSubmission, closeSessionOutcome, openRemediation,
      resolvePersonalCard, resolveScanAction,
    },
    economyCalls,
    busEvents,
    renderCalls: pdfRenderer.calls,

    /** Which learner the shorthand methods act for. */
    as(learnerId) { currentLearner = learnerId; return harness; },
    get learnerId() { return currentLearner; },

    // --- setup ---------------------------------------------------------------
    async assign({ learnerId = currentLearner, courses = [COURSE_ID], units = [] } = {}) {
      return assignments.put({ learnerId, courses, units, updatedAt: clock.iso() });
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
      return artifactId ? formMaps.get(artifactId) : null;
    },
    async lastFormMap(unitId = OMR_UNIT) {
      const sessionId = lastScan?.sessionId ?? await sessionIdFor(unitId);
      return sessionId ? harness.formMapFor(sessionId) : null;
    },

    /**
     * Draw the last receipt on the REAL thermal renderer. Nothing about the
     * item list proves a document can be put on tape — this does, and it is the
     * probe that catches a block the receipt target refuses.
     */
    async probeReceiptRendering(document) {
      const canvas = await receiptCanvasRenderer.createCanvas(document, {});
      return { width: canvas.width, height: canvas.height, codes: canvas.codes };
    },

    // --- media ---------------------------------------------------------------

    /**
     * Play the current dispatch to the end and let the completion signal reach
     * the lifecycle — the correlation the composition root subscribes for.
     */
    async playToEnd({ sessionId = lastScan?.sessionId, dispatchId = null } = {}) {
      const id = dispatchId ?? lastScan?.effect?.dispatchId
        ?? playback.listDispatches().at(-1)?.dispatchId;
      if (!id) throw new Error('playToEnd: nothing has been dispatched');
      const record = playback.playToEnd(id);
      lastResult = await recordMediaCompletion.execute({
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

    async checkStalled(sessionId) { return recordMediaCompletion.checkStalled({ sessionId }); },

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
      lastResult = await submitPaperWork.fromOmrSheet({ sessionId: id, sheet, submittedBy });
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
      lastResult = await submitPaperWork.execute({ sessionId: id, entries, ambiguous, blank, submittedBy });
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
        await submitPaperWork.execute({ sessionId: id, entries: {}, submittedBy: gradedBy });
      }
      lastResult = await gradeSubmission.execute({ sessionId: id, verdicts, gradedBy });
      return lastResult;
    },

    /** Machine-marked answers (the on-screen quiz, and the OMR feeder's output). */
    async grade({ sessionId = null, entries = {}, verdicts = {}, gradedBy = null } = {}) {
      const id = sessionId ?? lastScan?.sessionId;
      if (!id) throw new Error('grade: no session to mark');
      lastResult = await gradeSubmission.execute({ sessionId: id, entries, verdicts, gradedBy });
      return lastResult;
    },

    // --- settling ------------------------------------------------------------

    /**
     * Close a graded session out. The use case prints its own result receipt —
     * the harness used to do that here, which hid the fact that production
     * never did it at all.
     */
    async closeOutcome({ sessionId = null, signedOff = false } = {}) {
      const id = sessionId ?? lastScan?.sessionId;
      if (!id) throw new Error('closeOutcome: no session to settle');
      lastResult = await closeSessionOutcome.execute({ sessionId: id, signedOff });
      return lastResult;
    },

    // --- reading the record --------------------------------------------------

    async sessionState(sessionId) { return stateOf(sessionId); },
    async sessionIdFor(unitId, learnerId = currentLearner) { return sessionIdFor(unitId, learnerId); },
    async sessionRows(learnerId = currentLearner) { return sessionRows(learnerId); },
    async sessionEvents(sessionId) { return sessions.readEvents(sessionId); },
    async eventTypes(sessionId) { return (await sessions.readEvents(sessionId)).map((e) => e.type); },
    async reviewItems(sessionId) { return reviewQueue.listForSession(sessionId); },
    async pendingReview() { return reviewQueue.listPending(); },

    async agenda(learnerId = currentLearner) {
      return buildAgenda.execute({ learnerId, learnerName: userService.getProfile(learnerId)?.name ?? null });
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
      const bank = bankReader.getBank('math-fractions-01-quiz');
      const entries = answers ?? Object.fromEntries(bank.items
        .filter((item) => item.type !== 'matching')
        .map((item) => [item.id, item.answer]));
      const matching = bank.items.filter((item) => item.type === 'matching');
      for (const item of matching) entries[item.id] = item.pairs.map((p) => ({ ...p }));
      await submitPaperWork.execute({ sessionId, entries, submittedBy: learnerId });
      await gradeSubmission.execute({ sessionId, entries });
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
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };

  return harness;
}

/** Read a fixture bank straight off disk, for a test that needs the right answers. */
export function fixtureBank(id) {
  return yaml.load(fs.readFileSync(path.join(FIXTURE_DIR, 'banks', `${id}.yml`), 'utf8'));
}

export default createLifecycleHarness;
