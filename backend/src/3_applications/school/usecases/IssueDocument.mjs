/**
 * IssueDocument — put a sheet of paper in a child's hand (spec §2, §5.2, §9).
 *
 * Mints the tokens the sheet will carry, renders it, sends it to the laser
 * printer, keeps the form map, and records what happened on the session.
 *
 * Three things it is careful about:
 *
 *   1. **A reprint reuses the ORIGINAL artifact id** (§5.2). Reprinting under a
 *      fresh id would make one piece of work look like two, and would give the
 *      same bubbles two different form maps. The `reprinted` event carries the
 *      same id, which is what makes the lineage readable.
 *   2. **A printer failure is not an exception in the caller's face** (§9). The
 *      session records a `failed` annotation — which does NOT advance the state,
 *      so the token the child is holding stays valid — and the child gets a slip
 *      with a recovery ticket. The next scan retries.
 *   3. **The form map is written BEFORE the issue is recorded.** The paper is
 *      already out of the tray by then; if the two were the other way round, a
 *      fast child could scan a sheet whose geometry the server had not yet saved.
 *
 * The renderer arrives through `IDocumentRenderer` (D1: applications may not
 * import `1_rendering`). Token values are minted HERE and passed in — the
 * renderer draws barcodes, it does not decide what they mean.
 *
 * TRACKED QUIZZES (spec §9, Task 7): a unit whose `document` reference matches
 * `print/<id>@<rev>` resolves through the NEWER print-document pipeline
 * (`RenderPrintDocument` + the OMR card allocation store) instead of the
 * legacy curriculum document map — see `#issuePrintDocument` below, reached
 * by an early branch in `execute()` that never runs the legacy lookup for a
 * print-document unit, and is never reached for a legacy one. The allocation
 * record takes the FORM MAP'S SLOT in the write sequence (before the issue
 * event) — `#issuePrintDocument`'s own doc comment explains why that write
 * actually lands even earlier than the legacy slot, not later, and why that
 * is still the same guarantee.
 */
import { reduceSession, createEvent, statesAccepting } from '#domains/school/sessions/sessionEvents.mjs';
import { mintToken, TOKEN_CLASSES } from '#domains/school/sessions/tokens.mjs';
import { mintAccessCode } from '#domains/school/sessions/accessCode.mjs';
import { mintCode, formatCode } from '#domains/school/companionCode.mjs';
import { studyDayWindow } from '#domains/school/studyDay.mjs';
import { noticeDocument } from '#domains/school/documents/receipts.mjs';
import { walkBlocks } from '#domains/school/documents/documentValidation.mjs';
import { shortId } from '#system/utils/id.mjs';
import { createWorksheetInstance, worksheetInstanceDocument } from '#domains/school/questionBankV2.mjs';
import { PublishPrintDocument } from '#apps/school/documents/PublishPrintDocument.mjs';
import { deriveLearnerName, deriveIssueDate } from '#apps/school/documents/reprintContext.mjs';
import { slugify } from '#domains/school/documents/receipts.mjs';
import { DEFAULT_PRINT_POLICY } from '#domains/school/index.mjs';
import { lessonProgressRows } from '#domains/school/lessonProgress.mjs';
import { worksheetPresentation } from '#domains/school/curriculum/worksheetPresentation.mjs';
// The publish-time gate's own list (D12), read here rather than re-stated: the
// handlers that can actually release a finish code. See its doc comment.
import { COMPANION_COMPLETION_HANDLERS } from '#domains/school/curriculum/unitValidation.mjs';
import { resolveScripturePlaylist } from '../readalong/resolveScripturePlaylist.mjs';

/**
 * States in which handing over a sheet still means something — DERIVED from the
 * transition table, never written out by hand.
 *
 * Issuing appends either an `issued` (first sheet) or a `reprinted` (same
 * artifact again), so the answer is exactly the union of the states from which
 * those two events are legal. It used to be a literal four-element set here, a
 * second one in `IssueComposedWorksheet`, and a third in
 * `ListPrintableWorksheetSessions` — three copies of a projection that nothing
 * held to the table, free to drift the moment an edge moved.
 */
const ISSUABLE = new Set([...statesAccepting('issued'), ...statesAccepting('reprinted')]);

/**
 * `print/<id>@<rev>` — a curriculum unit's `document` field pointing at a
 * PUBLISHED print-document artifact (spec §9) rather than a legacy catalog
 * document id. `id` never contains `@` (the print-document id alphabet
 * excludes it — `documentValidation.mjs`'s `ID_PATTERN`); the remainder after
 * the LAST `@` is the rev, mirroring `YamlAllocationStore`'s own
 * `buildRecordId` convention for the same pair.
 */
const PRINT_DOCUMENT_REF = /^print\/([^@]+)@([^@]+)$/;

/**
 * `school.yml printing.printCooldownMinutes` — how long a session's most
 * recent SUCCESSFUL print silences a re-scan of the same ticket (spec: print
 * debounce). Validated the same defensive way `normalizeAnswerSheetPolicy`
 * is: this number reaches a re-scan's fast path on every single scan in the
 * house, so a malformed config value (a negative number, a string left over
 * from a YAML typo) must fail loudly at construction rather than silently
 * producing a debounce window that never expires or never engages.
 */
function normalizePrintCooldownMinutes(raw) {
  const minutes = raw ?? DEFAULT_PRINT_POLICY.printCooldownMinutes;
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new Error('IssueDocument: printCooldownMinutes must be a number >= 0');
  }
  return minutes;
}

function normalizeAnswerSheetPolicy(raw) {
  const reuse = raw?.reuse ?? 'after_scan';
  const capacity = raw?.capacity ?? 50;
  if (!['never', 'after_scan', 'school_day', 'until_full'].includes(reuse)) {
    throw new Error(`IssueDocument: unknown answer-sheet reuse policy "${reuse}"`);
  }
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 50) {
    throw new Error('IssueDocument: answer-sheet capacity must be an integer from 1 to 50');
  }
  return { reuse, capacity };
}

/**
 * The companion-code record's schema tag. A LITERAL, not an import: the schema
 * belongs to a `1_adapters` store this layer may not import (D1), exactly like
 * `'school.lesson-companion/v1'` already written by hand a few lines below in
 * `#prepareCompanion`. It must stay in step with `COMPANION_CODE_SCHEMA` in
 * `YamlCompanionCodeStore.mjs`.
 */
const COMPANION_CODE_SCHEMA = 'school.companion-code/v1';

/**
 * The `lessonDay` half of a companion code's scope
 * (`YamlCompanionCodeStore.keyFor`) — "the day the lesson BELONGS to, never the
 * day it was played".
 *
 * THERE IS NO AUTHORED DATE ON A UNIT. `unitValidation.mjs` admits `courseId`,
 * `sequence`, `module` and `moduleRole` and nothing date-shaped; the finest
 * authored date in the whole catalog is a course module's `opensOn`/`closesOn`
 * WEEK window. So this returns the lesson's PLACEMENT — its module, e.g.
 * `w35-aug24`, which names the week and the date that week opens — and never a
 * calendar day it does not have.
 *
 * That is sufficient, because `lessonId` is `unit.unitId`, which
 * `YamlCurriculumDatastore` keeps globally unique across every course and
 * subject, and which for a dated course already names the weekday:
 * `cfm-w35-d1-psalms-49-61` and `cfm-w35-d3-psalms-70-77` are two different
 * lessons in one module. `(householdId, lessonId)` therefore already pins one
 * record per lesson; `lessonDay` records WHEN that lesson sits, it does not
 * have to separate anything.
 *
 * TWO THINGS DELIBERATELY REJECTED, both of which would break the pinning
 * decision the scope exists for:
 *
 *   - Anything clock-derived (`studyDayWindow(nowIso)`, `state.studyDay`,
 *     `instance.issuedAt`). A sibling catching up a week later would compute a
 *     different key, mint a SECOND code, and be made to replay audio the
 *     household has already finished — while the first child's printed sheet
 *     still names the first code.
 *   - The true calendar day, `moduleSchedule[module].opensOn + (sequence - 1)`.
 *     It reads better and it is what the store's own test fixture shows, but
 *     `moduleSchedule` is a snapshot on the LEARNER'S ENROLLMENT, and a
 *     mid-course enrollee's copy omits weeks that had already closed. Two
 *     siblings would then resolve the same lesson differently — one to a date,
 *     one to a fallback — and land on two records. A scope component that
 *     varies by learner is precisely what dropping the learner was for.
 *
 * Pure: no clock, no I/O, no learner. Two prints of one lesson can only
 * disagree if the unit itself was re-authored into a different module, which
 * is a lesson genuinely moving.
 *
 * @param {object} unit
 * @param {string} [fallback] - `instance.lessonId`, for a standalone unit with
 *   no course placement at all. Never empty: `keyFor` rejects a blank part.
 * EXPORTED because `GetCompanionFinishCode` has to resolve the SAME record this
 * mints, and a second copy of the fallback chain that drifted by one link would
 * read a grown-up letters that cannot clear the child's printed gate. One
 * function, one scope.
 *
 * @returns {string|null}
 */
export function companionLessonDay(unit, fallback = null) {
  const usable = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
  return usable(unit?.module) ?? usable(unit?.courseId) ?? usable(unit?.unitId) ?? usable(fallback);
}

/**
 * The authored `companion.requireParts` as a COUNT, resolved against the
 * playlist that actually got built.
 *
 * `'all'` and "unauthored" both mean every part — the second because that is
 * what this minted before the field existed, and a lesson's gate must not
 * loosen just because someone added the field to the schema.
 *
 * Clamped to the playlist for the same reason `LessonCompanionHandlers` clamps
 * it on the way out: a unit asking for four chapters of a three-chapter reading
 * is a gate no child could ever open, and an author trimming a reading after
 * writing the number produces exactly that.
 *
 * @param {number|'all'|undefined} authored
 * @param {number|undefined} total - parts in the resolved playlist
 * @returns {number} at least 1
 */
function resolveRequireParts(authored, total) {
  const parts = Number.isInteger(total) && total >= 1 ? total : 1;
  if (!Number.isInteger(authored) || authored < 1) return parts;
  return Math.min(authored, parts);
}

/**
 * Does this unit ask for a GATE ROW — the thing only `#issueWorksheetInstance`
 * can actually print?
 *
 * `enabled: false` is the author saying there is no companion here at all, which
 * settles `participation` along with it (the same reading `#prepareCompanion`
 * takes on its first line). Everything else with `participation: required`
 * wants a gate, and a sheet that cannot carry one must refuse rather than print
 * an ungated copy: an ungated sheet passes on score alone, which is the single
 * outcome this whole feature exists to prevent.
 */
export function requiresCompanionGate(unit) {
  const companion = unit?.companion;
  return Boolean(companion) && companion.enabled !== false && companion.participation === 'required';
}

/** @returns {{id: string, rev: string}|null} */
function parsePrintDocumentRef(ref) {
  if (typeof ref !== 'string') return null;
  const match = PRINT_DOCUMENT_REF.exec(ref);
  return match ? { id: match[1], rev: match[2] } : null;
}

/**
 * What a child (and the grown-up they fetch) is told, per cause.
 *
 * Every entry carries a recovery ticket, because §9 says a failure is a retry.
 * They differ in WHO can clear it: paper and cables for `printer`, the
 * curriculum for `missing_artwork`, and a page that will not lay out for
 * `render`. Three different next moves, so three different slips.
 */
const FAILURE_COPY = Object.freeze({
  printer: {
    status: 'print_failed',
    slipId: 'print-failed',
    headline: 'The printer is not answering',
    lines: ['Your work is safe. Nothing was lost.'],
    message: 'The printer did not answer. Scan the ticket below to try again.',
    actionLabel: 'Try printing again',
  },
  missing_artwork: {
    status: 'render_failed',
    slipId: 'missing-artwork',
    headline: 'A picture is missing from that sheet',
    lines: [
      'Your work is safe. Nothing was lost.',
      'Show this to a grown-up — the sheet cannot be made until the picture is put back.',
    ],
    message: 'A picture on that sheet is missing, so it could not be made. Tell a grown-up.',
    actionLabel: 'Try again once it is fixed',
  },
  render: {
    status: 'render_failed',
    slipId: 'sheet-failed',
    headline: 'That sheet could not be made',
    lines: [
      'Your work is safe. Nothing was lost.',
      'Show this to a grown-up.',
    ],
    message: 'We could not make that sheet. Tell a grown-up, then scan the ticket below.',
    actionLabel: 'Try again once it is fixed',
  },
});

export class IssueDocument {
  #curriculum; #sessions; #tokens; #renderer; #printer; #formMaps; #bankReader;
  #printDocuments; #renderPrintDocument; #allocationStore;
  #assignments; #worksheetInstances; #publishPrintDocument; #companions;
  #companionCodes; #householdId;
  #issuedArtifacts; #curriculumExceptions;
  #answerSheetPolicy; #printCooldownMinutes;
  #clock; #rng; #newArtifactId; #timezone; #logger;

  /**
   * @param {object} deps
   * @param {import('../CurriculumAccess.mjs').CurriculumAccess} deps.curriculum
   * @param {import('../ports/IWorkSessionRepository.mjs').IWorkSessionRepository} deps.sessions
   * @param {import('../ports/ITokenRegistry.mjs').ITokenRegistry} deps.tokens
   * @param {import('../ports/IDocumentRenderer.mjs').IDocumentRenderer} deps.renderer
   * @param {{printPdf: Function}} deps.printer - laser printer adapter surface
   * @param {import('../ports/IFormMapStore.mjs').IFormMapStore} deps.formMaps
   * @param {{getBank: (id: string) => object|null}} [deps.bankReader] - questions the sheet poses
   * @param {{getPublished: (id: string, rev?: string) => Promise<object|null>|object|null}} [deps.printDocuments] -
   *   `YamlPrintDocumentRepository`-shaped (Task 7, spec §9). Resolves a unit's
   *   `print/<id>@<rev>` document reference to its published artifact. Optional:
   *   absent it, a `print/...` reference degrades to `unavailable` exactly like a
   *   dangling legacy reference does — it never falls through to `curriculum`.
   * @param {{execute: Function}} [deps.renderPrintDocument] - a `RenderPrintDocument`
   *   instance (Task 5), constructed with its OWN `repository`/`banks`/
   *   `allocationStore` at composition time. Required alongside `printDocuments`/
   *   `allocationStore` for a `print/...` unit to actually render.
   * @param {{allocate: Function}} [deps.allocationStore] - the SAME allocation
   *   store `renderPrintDocument` writes through — held here only so a
   *   `print/...` unit can be recognised as configured (or not) before minting
   *   anything; the actual persisting write happens inside `renderPrintDocument`
   *   itself (see `#issuePrintDocument`'s doc comment for why it cannot be
   *   deferred to the form-map slot the way a legacy map is).
   * @param {{keyFor: Function, findOrCreate: Function, get: Function, update: Function}}
   *   [deps.companionCodes] - `YamlCompanionCodeStore`-shaped, injected by the
   *   composition root (never imported here — D1). Holds ONE finish code per
   *   `(householdId, lessonId, lessonDay)`; a required companion cannot be
   *   printed without it, because the gate row would name a code nothing can
   *   check. Absent for an optional companion, which has no gate at all.
   * @param {string|null} [deps.householdId] - the household whose codes these
   *   are: the first third of that scope, and the reason two houses on the same
   *   published lesson never share a code.
   * @param {() => Date} [deps.clock]
   * @param {() => number} [deps.rng]
   * @param {() => string} [deps.newArtifactId]
   * @param {number} [deps.printCooldownMinutes] - `school.yml printing.printCooldownMinutes`
   *   (default `DEFAULT_PRINT_POLICY.printCooldownMinutes`, 10). See the
   *   debounce check near the top of `execute()` for the deliberate silence
   *   this implements.
   * @param {object} [deps.logger]
   */
  constructor({
    curriculum, sessions, tokens, renderer, printer, formMaps, bankReader = null,
    printDocuments = null, renderPrintDocument = null, allocationStore = null,
    assignments = null, worksheetInstances = null, publishPrintDocument = null, companions = null,
    companionCodes = null, householdId = null,
    issuedArtifacts = null, curriculumExceptions = null,
    answerSheetPolicy = null, printCooldownMinutes = null,
    clock = () => new Date(), rng = Math.random, timezone = null,
    newArtifactId = () => `art_${shortId(8)}`, logger = console,
  } = {}) {
    if (!curriculum || !sessions || !tokens || !renderer || !printer || !formMaps) {
      throw new Error('IssueDocument requires curriculum, sessions, tokens, renderer, printer and formMaps');
    }
    this.#curriculum = curriculum;
    this.#sessions = sessions;
    this.#tokens = tokens;
    this.#renderer = renderer;
    this.#printer = printer;
    this.#formMaps = formMaps;
    this.#bankReader = bankReader;
    this.#printDocuments = printDocuments;
    this.#renderPrintDocument = renderPrintDocument;
    this.#allocationStore = allocationStore;
    this.#assignments = assignments;
    this.#worksheetInstances = worksheetInstances;
    this.#companions = companions;
    this.#companionCodes = companionCodes;
    this.#householdId = householdId;
    this.#issuedArtifacts = issuedArtifacts;
    this.#curriculumExceptions = curriculumExceptions;
    this.#answerSheetPolicy = normalizeAnswerSheetPolicy(answerSheetPolicy);
    this.#printCooldownMinutes = normalizePrintCooldownMinutes(printCooldownMinutes);
    this.#publishPrintDocument = publishPrintDocument
      ?? (printDocuments ? new PublishPrintDocument({ repository: printDocuments }) : null);
    this.#clock = clock;
    this.#rng = rng;
    this.#newArtifactId = newArtifactId;
    this.#timezone = timezone;
    this.#logger = logger;
  }

  /** Whether a bank-only unit uses the immutable paper-instance pipeline. */
  canIssueBank(bankId) {
    if (!this.#worksheetInstances || !this.#assignments || !this.#publishPrintDocument) return false;
    const bank = this.#bankReader?.getBank(bankId);
    // SchoolService returns validated banks without their schema discriminator;
    // compact-v2's answer(s)+decoys authoring shape remains distinctive.
    return Array.isArray(bank?.items) && bank.items.length > 0
      && bank.items.every((item) => Array.isArray(item.decoys));
  }

  /**
   * @param {object} args
   * @param {string} args.sessionId
   * @returns {Promise<{ status: 'issued'|'reprinted'|'print_failed'|'render_failed'|'unavailable'|'already_done',
   *                     sessionId: string, artifactId: string|null, pageCount: number|null,
   *                     tokens: Record<string,string>, document: object|null, message: string }>}
   *   `document` is a receipt document to print when something needs explaining;
   *   null on the happy path, where the worksheet itself is the evidence.
   */
  async execute({ sessionId } = {}) {
    const nowIso = this.#clock().toISOString();
    const events = await this.#sessions.readEvents(sessionId);
    const state = reduceSession(events);

    if (!state.sessionId) return this.#unavailable(sessionId, 'unknown-session', 'We could not find that work.');
    const paused = (await this.#curriculumExceptions?.active?.() ?? [])
      .find((exception) => exception.kind === 'paused' && exception.resolvedLessonIds?.includes(state.unitId));
    if (paused) return this.#unavailable(sessionId, 'content-paused', `This lesson is paused: ${paused.reason}.`);
    if (!ISSUABLE.has(state.state)) {
      return {
        status: 'already_done',
        sessionId,
        artifactId: state.issuedArtifacts.at(-1) ?? null,
        pageCount: null,
        tokens: {},
        message: 'That sheet is already done with. Scan your card to see what is next.',
        document: noticeDocument({
          id: `done-${sessionId}`,
          headline: 'All finished with that one',
          lines: ['Scan your card to see what is next.'],
        }),
      };
    }

    // PRINT DEBOUNCE (spec: a household print quota, not a paper factory).
    // Two scans of the SAME ticket ten seconds apart used to put two
    // identical worksheets on the laser printer — nothing in the school
    // layers deduplicated a PRINT, only card-scan ingestion and bank
    // warming. `state.issuedArtifacts.length > 0` is exactly "this session
    // has printed before" (every one of the three issuing branches below
    // shares the same `issued`/`reprinted` event vocabulary), and
    // `state.lastPrintedAt` is stamped ONLY by a successful print (see
    // `sessionEvents.mjs`) — never by a `failed` annotation — which is what
    // lets an offline-printer retry go through immediately below instead of
    // being silenced by the very failure it is trying to recover from.
    //
    // THIS IS A DELIBERATE, AUTHORISED EXCEPTION to `tokens.mjs`'s house
    // rule that "a scan never succeeds silently, and never dead-ends" — every
    // other non-happy-path in this file hands back a message, a slip, a
    // recovery ticket. This one hands back nothing at all: no worksheet, no
    // receipt, no explanation. That was a conscious call (the household chose
    // silence over a redundant thermal slip for every debounced re-scan, not
    // an oversight this comment is here to flag) — see `ResolveScanAction`'s
    // own `#print`, which special-cases `status: 'debounced'` to skip its
    // receipts fallback for the identical reason. Do not "fix" this back to
    // printing a slip; that reintroduces the very duplicate-output bug the
    // debounce exists to remove.
    if (state.issuedArtifacts.length > 0 && this.#withinPrintCooldown(state.lastPrintedAt, nowIso)) {
      this.#logger.info?.('school.issue.print-debounced', {
        sessionId, unitId: state.unitId, artifactId: state.issuedArtifacts.at(-1), lastPrintedAt: state.lastPrintedAt,
      });
      return {
        status: 'debounced',
        sessionId,
        artifactId: state.issuedArtifacts.at(-1),
        pageCount: null,
        tokens: {},
        document: null,
        message: '',
      };
    }

    // An issued artifact is the physical record, not a recipe to be rendered
    // again.  In particular, an older session may predate byte retention.  A
    // later scan must not manufacture a current rendering and file it under
    // the original artifact id: that would make teacher history lie about
    // what the learner received.  Reprint exact retained bytes — or, if the
    // bytes are gone, `#reprintExact` itself falls through to a labelled
    // replacement (see that method).
    if (state.issuedArtifacts.length > 0) {
      return this.#reprintExact({ sessionId, nowIso, state });
    }

    return this.#issueNew({ sessionId, nowIso, state });
  }

  /**
   * Selects which pipeline hands over a sheet for a unit that has nothing
   * issued yet — bank-only worksheet instance, tracked-quiz print-document,
   * or the legacy curriculum document map — and defers to it.
   *
   * Also the FALL-THROUGH `#reprintExact` reaches when the exact artifact's
   * bytes are gone (2026-08-25 incident): `replacementArtifactId` is the
   * ORIGINAL (missing) artifactId in that case, `null` for a true first
   * issue. Threading it down is what lets each pipeline both (a) regenerate
   * from the SAME unit/document configuration a first issue would use — so
   * the replacement carries the same questions, not a different variant —
   * and (b) record the result as a `reprinted` event under that SAME
   * artifactId rather than a fresh `issued` one. That is not a stylistic
   * choice: `TRANSITIONS` in `sessionEvents.mjs` makes `reprinted` the ONLY
   * event legal from a session already in `issued`/`reprinted` state, and
   * `reprinted`'s own reducer rule requires the artifactId to already be
   * known — see `#reprintExact`'s doc comment for the full reasoning.
   */
  async #issueNew({ sessionId, nowIso, state, replacementArtifactId = null }) {
    const unit = await this.#curriculum.getUnit(state.unitId);

    // V2 bank-only lessons are printable worksheets. Their authored bank is
    // sampled once into a learner/enrollment-specific immutable instance;
    // every render and scan after this point resolves that frozen artifact.
    if (unit?.bank && !unit.document && this.#worksheetInstances && this.#assignments) {
      return this.#issueWorksheetInstance({
        sessionId, nowIso, state, unit, replacementArtifactId,
      });
    }

    // Tracked quizzes (spec §9): a `print/<id>@<rev>` unit-document reference
    // resolves through the print-document pipeline instead of the legacy
    // curriculum document map — a branch AHEAD of the legacy lookup below,
    // which it never runs. Everything from here to the end of this method is
    // unchanged for a legacy unit (this branch is simply never taken).
    const printRef = unit?.document ? parsePrintDocumentRef(unit.document) : null;

    // ONLY THE PIPELINE ABOVE CAN CARRY A GATE ROW, so everything below refuses
    // to print a lesson that needs one.
    //
    // `#prepareCompanion` — which mints the finish code and is the whole reason
    // a gate row exists — is called from `#issueWorksheetInstance` and nowhere
    // else. Neither `#issuePrintDocument` nor `#issueLegacyDocument` prepares a
    // companion, so before this guard a `participation: required` lesson on
    // either of them printed a sheet with NO gate row: the child answers, the
    // scan reports no `companionGate`, `evaluateOutcome`'s veto clause never
    // fires, and the sheet passes on score alone with nothing logged anywhere.
    //
    // Teaching those pipelines to print a gate row is a FEATURE, not a fix.
    // `COMPANION_GATE_ITEM_ID` is one fixed constant, justified in its own
    // comment by "a worksheet has exactly one gate, so one fixed id is enough";
    // a per-path gate needs a per-section gate id, a matching partition in
    // `ResolveCardScan`, and new row-capacity arithmetic. Until that exists,
    // refusing is the honest answer — and it is recoverable, because nothing
    // has been minted, rendered, allocated or printed at this point, so the
    // session does not advance and the ticket in the child's hand stays valid.
    if (requiresCompanionGate(unit)) {
      this.#logger.warn?.('school.issue.companion-gate-unsupported', {
        sessionId,
        unitId: state.unitId,
        document: unit.document ?? null,
        pipeline: printRef ? 'print-document' : 'legacy-document',
      });
      return this.#unavailable(
        sessionId,
        'companion-gate-unsupported',
        'This lesson needs a read-along that this kind of sheet cannot check. Tell a grown-up.',
      );
    }

    if (printRef) {
      return this.#issuePrintDocument({
        sessionId, nowIso, state, unit, printRef, replacementArtifactId,
      });
    }

    const document = unit?.document ? await this.#curriculum.getDocument(unit.document) : null;
    if (!document) {
      // A dangling reference should be impossible at runtime (the catalog gate
      // resolves every reference at publish time), so it is logged loudly as
      // well as explained on paper.
      this.#logger.warn?.('school.issue.no-document', { sessionId, unitId: state.unitId, document: unit?.document ?? null });
      return this.#unavailable(sessionId, 'no-document', 'There is no sheet to print for this one. Tell a grown-up.');
    }
    return this.#issueLegacyDocument({
      sessionId, nowIso, state, unit, document, replacementArtifactId,
    });
  }

  async #issueLegacyDocument({
    sessionId, nowIso, state, unit, document, replacementArtifactId = null,
  }) {
    const artifactId = replacementArtifactId ?? this.#newArtifactId();
    const tokens = await this.#mintSheetTokens(document, sessionId, nowIso);

    let rendered;
    try {
      rendered = await this.#renderer.render(
        // The VARIANT rides on the document, not just the options: it is what
        // makes a retry sheet a different sheet, and the renderer derives the
        // form map's identity from the document it was handed. A variant passed
        // only alongside would be a variant the paper does not actually carry.
        state.variant === (document.variant ?? 0) ? document : { ...document, variant: state.variant },
        {
          tokens,
          variant: state.variant,
          artifactId,
          sessionId,
          learnerId: state.learnerId,
          bank: unit.bank ? (this.#bankReader?.getBank(unit.bank) ?? null) : null,
        },
      );
    } catch (err) {
      return this.#recordFailure({
        sessionId, stage: 'render', reason: err.message, nowIso, state,
        // Read by NAME, not by class: `1_rendering` is not importable from here
        // (D1), and the renderer arrives through a port that may be any
        // implementation. The name is part of that port's contract.
        cause: err.name === 'UnresolvedAssetError' ? 'missing_artwork' : 'render',
      });
    }

    rendered.artifact = await this.#retainIssuedArtifact({
      artifactId, rendered, nowIso, sessionId, state,
      captureKind: replacementArtifactId ? 'replacement' : 'original',
    });
    let printResult;
    try {
      printResult = await rendered.artifact.printWith(this.#printer, {
        jobName: `school-${state.unitId}-${artifactId}`,
        user: state.learnerId ?? 'daylight',
      });
    } catch (err) {
      return this.#recordFailure({ sessionId, stage: 'print', reason: err.message, nowIso, state, cause: 'printer' });
    }

    // Written first-wins and BEFORE the issue event: see the header.
    if (rendered.formMap) await this.#formMaps.put(artifactId, rendered.formMap);

    // `reprinted` (not `issued`) whenever this is a replacement for a
    // session already in `issued`/`reprinted` state — see `#issueNew`'s doc
    // comment for why that is the only legal transition, and why it reuses
    // `replacementArtifactId` rather than a fresh id.
    const type = replacementArtifactId ? 'reprinted' : 'issued';
    const { errors, event } = createEvent({
      type, at: nowIso, sessionId, artifactId, confirmed: this.#printConfirmed(printResult),
    });
    if (errors.length) throw new Error(`IssueDocument: could not record the issue: ${errors.join('; ')}`);
    await this.#sessions.appendEvent(sessionId, event);

    this.#logger.info?.('school.issue.printed', {
      sessionId, unitId: state.unitId, artifactId, reprint: false,
      replacement: Boolean(replacementArtifactId), pages: rendered.pageCount ?? null,
    });

    return {
      status: type,
      sessionId,
      artifactId,
      pageCount: rendered.pageCount ?? null,
      tokens,
      formMap: rendered.formMap ?? null,
      document: null,
      message: replacementArtifactId
        ? 'The original of that sheet was not saved, so a fresh copy is being printed.'
        : 'Printing your sheet.',
    };
  }

  async #reprintExact({ sessionId, nowIso, state }) {
    const artifactId = state.issuedArtifacts.at(-1);
    const retained = await this.#issuedArtifacts?.get?.(artifactId) ?? null;
    if (!retained) {
      // The `issued` event is real — the child DID receive a sheet — but the
      // bytes are gone: retention predates this session (2026-08-25 incident:
      // the session was issued 2026-08-23, before the retention store existed)
      // or a write never landed. Refusing here, as this code used to, left the
      // session PERMANENTLY unprintable: "already issued" (this branch was
      // reached) and "doesn't exist" (the bytes are gone) are both true, and
      // there was no third option. See
      // docs/_wip/bugs/2026-08-25-unprintable-session-already-issued-but-gone.md.
      //
      // The integrity rule this branch exists for stays intact: we never
      // claim a fresh rendering IS the original. `#issueNew` regenerates from
      // the SAME unit/document configuration a first issue would use (so the
      // child gets the same questions, not a different variant) and records
      // the result honestly — the retained manifest's `captureKind` is
      // `'replacement'`, not `'original'`, and the printed message says a
      // fresh copy is being made. What was wrong was refusing to make one.
      //
      // The event this appends is `reprinted`, reusing THIS SAME artifactId,
      // not a freshly minted one: `TRANSITIONS['issued']` /
      // `TRANSITIONS['reprinted']` in `sessionEvents.mjs` do not include
      // `issued` as a legal next event once a session has already issued
      // once — only `reprinted` is — and `reprinted`'s own reducer rule
      // requires the artifactId to already be in `issuedArtifacts`. Reusing
      // the id here is also what HEALS the gap: once these regenerated bytes
      // are retained under it, the next print of this session finds them and
      // takes the plain branch below, unchanged.
      this.#logger.warn?.('school.issue.exact-artifact-unavailable', {
        sessionId, unitId: state.unitId, artifactId,
      });
      const result = await this.#issueNew({ sessionId, nowIso, state, replacementArtifactId: artifactId });
      this.#logger.warn?.('school.issue.replacement-issued', {
        sessionId, unitId: state.unitId, missingArtifactId: artifactId, newArtifactId: result.artifactId ?? null,
      });
      return result;
    }
    let printResult;
    try {
      printResult = await this.#printer.printPdf(retained.bytes, {
        jobName: `school-${state.unitId}-${artifactId}`,
        user: state.learnerId ?? 'daylight',
        duplex: retained.manifest?.renderContext?.duplex ?? undefined,
      });
    } catch (err) {
      return this.#recordFailure({ sessionId, stage: 'print', reason: err.message, nowIso, state, cause: 'printer' });
    }
    const { errors, event } = createEvent({
      type: 'reprinted', at: nowIso, sessionId, artifactId, confirmed: this.#printConfirmed(printResult),
    });
    if (errors.length) throw new Error(`IssueDocument: could not record exact reprint: ${errors.join('; ')}`);
    await this.#sessions.appendEvent(sessionId, event);
    this.#logger.info?.('school.issue.exact-reprinted', {
      sessionId, unitId: state.unitId, artifactId, pages: retained.manifest?.pageCount ?? null,
    });
    return {
      status: 'reprinted', sessionId, artifactId,
      pageCount: retained.manifest?.pageCount ?? null, tokens: {}, allocation: retained.manifest?.allocation ?? null,
      document: null, message: 'Printing that exact worksheet again.',
    };
  }

  async #issueWorksheetInstance({
    sessionId, nowIso, state, unit, replacementArtifactId = null,
  }) {
    if (!this.#renderPrintDocument || !this.#publishPrintDocument || !this.#allocationStore) {
      return this.#unavailable(sessionId, 'worksheet-instance-not-configured', 'There is no sheet to print for this one.');
    }
    const assignment = await this.#assignments.get(state.learnerId);
    const course = (assignment?.courses ?? []).find((entry) => (
      entry.courseId === unit.courseId || entry.enrollment?.lessonOrder
        && Object.values(entry.enrollment.lessonOrder).flat().includes(unit.unitId)
    ));
    const enrollmentId = course?.enrollment?.enrollmentId;
    const profile = course?.profile ?? course?.enrollment?.profile;
    if (!enrollmentId || !profile) {
      return this.#unavailable(sessionId, 'no-enrollment', 'This lesson is not enrolled for this learner.');
    }
    const works = await this.#curriculum.listWorks?.() ?? [];
    const work = works.find((candidate) => candidate?.work === unit.courseId) ?? null;
    const presentation = worksheetPresentation({ unit, work, enrollment: course?.enrollment });

    let instance = await this.#worksheetInstances.findBySession(sessionId);
    const existingInstance = Boolean(instance);
    // Whether THIS render's document carries a companion gate row (Task 8).
    // It costs a card row of its own, so `rowsNeeded` below has to know — an
    // undercount by one runs the last question off the end of the card.
    let gateRows = 0;
    if (!instance) {
      const id = `${slugify(unit.subject ?? 'school')}/${slugify(course.courseId)}/ws-${slugify(sessionId)}`;
      const bank = this.#bankReader?.getBank(unit.bank);
      if (!bank) return this.#unavailable(sessionId, 'no-bank', 'There are no questions for this lesson.');
      instance = createWorksheetInstance({
        id, sessionId, bank, learnerId: state.learnerId, enrollmentId,
        lessonId: unit.unitId, profile, seed: `${sessionId}:${state.variant ?? 0}`, issuedAt: nowIso,
        itemIds: state.remediationOf && state.remediationItemIds?.length ? state.remediationItemIds : null,
      });
      const companion = await this.#prepareCompanion({ instance, unit, nowIso });
      // A required companion this lesson cannot actually offer refuses BEFORE
      // anything is rendered, published, allocated or printed — never a gate a
      // child cannot clear. Nothing has been written yet at this point, so the
      // session does not advance and the ticket in their hand stays valid.
      if (companion?.refusal) {
        return this.#unavailable(sessionId, companion.refusal.reason, companion.refusal.message);
      }
      gateRows = companion?.finishCode ? 1 : 0;
      const published = await this.#publishPrintDocument.execute({
        source: worksheetInstanceDocument(instance, {
          title: unit.title,
          description: presentation.citation,
          sourceTitle: presentation.sourceTitle,
          printedPages: presentation.printedPages,
          reading: presentation.reading,
          subjectIcon: unit.subject ?? 'school',
          subjectName: unit.subject ?? 'School',
          breadcrumb: presentation.breadcrumb,
          passPercent: unit.passing?.percent ?? null,
          progress: await this.#lessonProgress({ state, unit, nowIso }),
          companionCode: companion?.accessCode ?? null,
          // TWO CODES, NEVER THE SAME FIELD. `companionCode` above is the
          // SIX-DIGIT ACCESS CODE printed on the lesson card's Read Along
          // panel — the number that OPENS the companion. `finishCode` is the
          // A–E set that finishing it RELEASES, and it becomes the sheet's
          // gate row (Task 8). Null for an optional companion, which has no
          // gate at all, so its worksheet is unchanged.
          //
          // This is the ONLY place the finish code leaves this method. It
          // travels into the published print document (server-side YAML, read
          // by the renderer and the scan-back resolver, served to a browser by
          // no route) and never onto `execute()`'s return value, which reaches
          // `ResolveScanAction` and a child's screen.
          finishCode: companion?.finishCode ?? null,
        }),
      });
      instance = { ...instance, documentId: published.id, documentRevision: published.rev };
    }

    const publishedDocument = await this.#printDocuments.getPublished(instance.documentId, instance.documentRevision);
    const learnerName = deriveLearnerName(instance.learnerId);
    const issueDate = deriveIssueDate(instance.issuedAt);
    const reusableCard = !existingInstance && typeof this.#allocationStore.findReusableCard === 'function'
      ? await this.#allocationStore.findReusableCard({
        learnerId: instance.learnerId,
        // The gate row is a printed row like any other and consumes one of the
        // card's fifty; `instance.questions` does not know about it.
        rowsNeeded: instance.questions.length + gateRows,
        capacity: this.#answerSheetPolicy.capacity,
        reuse: this.#answerSheetPolicy.reuse,
      })
      : null;
    // Header manifest (Task 2, RenderPrintDocument's `context.passPercent`):
    // `unit.passing.percent` is the SAME field `GradeSubmission`/
    // `CloseSessionOutcome` already read as the authoritative pass bar for
    // closing this exact lesson's session — reading anything else here (a
    // course-level default, a hand-copied constant) would risk the printed
    // sheet disagreeing with what actually grades it. `?? null` (no
    // `passing` authored for this unit) prints the question count alone —
    // see `RenderPrintDocument`'s `buildManifestText`.
    const passPercent = unit.passing?.percent ?? null;
    let rendered;
    try {
      const result = await this.#renderPrintDocument.execute({
        document: publishedDocument,
        context: existingInstance && instance.omr?.cardId
          ? {
            cardId: instance.omr.cardId, startRow: instance.omr.rowRange.start, learnerId: state.learnerId, learnerName, date: issueDate, sessionId, passPercent,
          }
          : reusableCard
            ? {
              ...reusableCard, learnerId: state.learnerId, learnerName, date: issueDate, sessionId, passPercent,
            }
            : {
              freshCard: true, learnerId: state.learnerId, learnerName, date: issueDate, sessionId, passPercent,
            },
      });
      rendered = {
        pdf: result.bytes, pageCount: result.pageCount, allocation: result.allocation,
        // Carried so the print job matches the geometry that was drawn — see
        // the `printPdf` call below.
        duplex: result.duplex,
      };
    } catch (err) {
      await this.#orphanAllocation(err.details?.allocation, { sessionId, unitId: state.unitId, stage: 'render' });
      return this.#recordFailure({ sessionId, stage: 'render', reason: err.message, nowIso, state, cause: 'render' });
    }

    if (!existingInstance) {
      // Card identity only. The answer key — every question's visible options,
      // their printed A–E letters, and which are `correct` — already lives once
      // on `instance.questions[].options` (minted by `issueWorksheet`), and that
      // is the copy graders and reprints read. An `omr.letters` mirror of it was
      // written here until 2026-08-15 and read by nothing; it only widened the
      // blast radius of a leaked instance file. Instances persisted before then
      // may still carry the vestigial field — the store is append-only, so it is
      // left in place rather than rewritten out of history. Nothing reads it.
      instance = {
        ...instance,
        omr: {
          cardId: rendered.allocation.cardId,
          recordId: rendered.allocation.recordId,
          rowRange: rendered.allocation.rowRange,
        },
      };
      await this.#worksheetInstances.put(instance);
    }

    // `instance.id` is derived purely from `sessionId`/course/subject
    // (`createWorksheetInstance` above), so it is already the SAME value as
    // `replacementArtifactId` whenever one is supplied — this is what lets a
    // replacement for this pipeline regenerate under the exact id the missing
    // artifact was recorded under, with no separate id-reconciliation needed.
    const artifactId = replacementArtifactId ?? instance.id;

    rendered.pdf = await this.#retainIssuedPdf({
      artifactId, rendered, nowIso, sessionId, state,
      worksheetInstanceId: instance.id, allocation: rendered.allocation,
      document: publishedDocument,
      captureKind: replacementArtifactId ? 'replacement' : 'original',
    });
    let printResult;
    try {
      printResult = await this.#printer.printPdf(rendered.pdf, {
        jobName: `school-${state.unitId}-${artifactId}`,
        user: state.learnerId,
        // The DOCUMENT decides whether this sheet is double-sided, not the
        // adapter's global default: the renderer reserved the 3-hole-punch
        // gutter either alternating by page parity (duplex) or fixed to the
        // left of every page (simplex), and only one of those survives being
        // folded onto one sheet. `undefined` (the v1 legacy path, which draws
        // no gutter at all) falls through to the adapter default.
        duplex: rendered.duplex ?? undefined,
      });
    } catch (err) {
      await this.#orphanAllocation(rendered.allocation, { sessionId, unitId: state.unitId, stage: 'print' });
      return this.#recordFailure({ sessionId, stage: 'print', reason: err.message, nowIso, state, cause: 'printer' });
    }
    // `reprinted` (not `issued`) for a replacement — see `#issueNew`'s doc
    // comment: it is the only event legal from a session already in
    // `issued`/`reprinted` state.
    const type = replacementArtifactId ? 'reprinted' : 'issued';
    const { errors, event } = createEvent({
      type, at: nowIso, sessionId, artifactId, confirmed: this.#printConfirmed(printResult),
    });
    if (errors.length) throw new Error(`IssueDocument: could not record worksheet instance: ${errors.join('; ')}`);
    await this.#sessions.appendEvent(sessionId, event);
    return {
      status: type, sessionId, artifactId, worksheetInstanceId: instance.id,
      pageCount: rendered.pageCount, tokens: {}, allocation: rendered.allocation,
      document: null,
      message: replacementArtifactId
        ? 'The original of that sheet was not saved, so a fresh copy is being printed.'
        : 'Printing your worksheet.',
    };
  }

  async #retainIssuedArtifact({ artifactId, rendered, nowIso, sessionId, state,
    worksheetInstanceId = null, allocation = null, document = null, captureKind = 'original' }) {
    return rendered.artifact.retainWith(this.#issuedArtifacts, {
      artifactId, pageCount: rendered.pageCount ?? null,
      issuedAt: nowIso, sessionId, learnerId: state.learnerId, unitId: state.unitId,
      captureKind, worksheetInstanceId, allocation,
      kind: 'worksheet', document,
      renderContext: {
        learnerId: state.learnerId ?? null, sessionId,
        variant: state.variant ?? 0, passPercent: state.passingPercent ?? null,
        duplex: rendered.duplex ?? null,
      },
    });
  }

  /**
   * Create the offer before rendering, so the retained PDF owns its code.
   *
   * TWO CODES, TWO MEANINGS, ONE PLACE (Task 7). The six-digit `accessCode`
   * OPENS the companion; the A–E `finishCode` is what finishing it RELEASES,
   * and Task 8 prints it as the worksheet's gate row. Both are resolved HERE,
   * before a single byte is rendered, for the reason this method already
   * existed: the retained PDF must own what is printed on it. A finish code
   * settled any later could disagree with the paper in a child's hand, and the
   * paper is the thing that cannot be edited.
   *
   * The two are never the same field. `companionCode` on the lesson card
   * (`worksheetInstanceDocument`'s option below) has ALWAYS meant the six-digit
   * access code; the A–E value is `finishCode` everywhere.
   *
   * WHY A REQUIRED COMPANION WITH NO MEDIA REFUSES TO PRINT. The gate row is
   * graded against the record; without media there is no record and no code, so
   * the row would print blank or print a code nothing can check, and the sheet
   * could never pass however well it was answered. Refusing is recoverable —
   * the child keeps a live ticket and a grown-up fixes the lesson — where a
   * printed unclearable gate is not. The refusal travels back as a `refusal`
   * envelope rather than a thrown error, so the caller answers with the same
   * `#unavailable` slip every other "we could not print that" branch uses.
   *
   * WHY A REQUIRED COMPANION'S ACCESS CODE OUTLIVES THE STUDY DAY. An optional
   * companion's code dies at the household's 4am boundary — it is an offer for
   * today, and tomorrow's list will make a fresh one. A required one is a
   * dependency of a sheet still sitting in a folder: expiring it overnight
   * strands the child with a gate row they can no longer reach the audio to
   * clear. So for `required` the access code lives exactly as long as the
   * token's own 7-day window.
   *
   * @returns {Promise<{accessCode: string, finishCode: string[]|null,
   *                    codeRef: string|null} | {refusal: {reason: string, message: string}} | null>}
   */
  async #prepareCompanion({ instance, unit, nowIso }) {
    const configured = unit?.companion ?? {};
    // `enabled: false` is the author saying there is no companion here at all,
    // which settles `participation` along with it: no offer, no gate, nothing
    // for a child to clear, so nothing to refuse over either.
    if (configured.enabled === false) return null;
    const required = configured.participation === 'required';
    if (!this.#companions && !required) return null;

    const playlist = configured.handler && configured.handler !== 'readalong'
      ? null : resolveScripturePlaylist(unit?.provenance?.reading);
    const companion = configured.handler && configured.handler !== 'readalong'
      ? { handler: configured.handler, label: configured.label ?? 'Open companion', payload: configured.payload ?? {} }
      : playlist ? { handler: 'readalong', label: configured.label ?? 'Read along', payload: { playlist } } : null;

    if (required) {
      // Everything a gate needs to exist AND to be checkable later. Named
      // individually so the log says which one is missing — "companion
      // unavailable" over a mis-wired composition sends a grown-up to the
      // curriculum for a problem that is not there.
      // `trim()`, not a bare falsiness check: `keyFor` refuses a blank part by
      // THROWING, and a throw here escapes `execute` through `asyncHandler` as a
      // 500 — bypassing the very slip this branch exists to hand a grown-up. The
      // store trims for the same reason: this codebase has a standing YAML
      // leading-space gotcha, so a household id of `'   '` is a real shape.
      //
      // `no-completion-contract` is BELT AND BRACES behind D12's publish-time
      // check in `unitValidation`: the handler decides which renderer mounts,
      // and only the handlers in `COMPANION_COMPLETION_HANDLERS` implement a
      // `recordProgress` that can ever release the finish code. On any other
      // handler the code would mint, the gate row would print, and nothing in
      // the system could open it — a child holding a gate with no lock. A unit
      // that reaches here that way was published before the validation existed,
      // or written into the tree by hand, so it is refused rather than trusted.
      const missing = !companion ? 'no-media'
        : !COMPANION_COMPLETION_HANDLERS.includes(companion.handler) ? 'no-completion-contract'
          : !this.#companions ? 'store-not-configured'
            : !this.#companionCodes ? 'code-store-not-configured'
              : !this.#householdId?.trim?.() ? 'no-household' : null;
      if (missing) {
        this.#logger.warn?.('school.issue.companion-required-unavailable', {
          sessionId: instance.sessionId, lessonId: instance.lessonId, reason: missing,
          ...(missing === 'no-completion-contract' ? { handler: companion.handler } : {}),
        });
        return {
          refusal: {
            reason: `companion-${missing}`,
            // Two sentences, because they are two different facts for the
            // grown-up who gets fetched: a read-along that is not ready yet may
            // simply need its media, while one nothing can finish needs the
            // lesson re-authored.
            message: missing === 'no-completion-contract'
              ? 'This lesson needs a read-along that nothing can finish. Tell a grown-up.'
              : 'This lesson needs a read-along that is not ready. Tell a grown-up.',
          },
        };
      }
    }
    if (!companion) return null;

    let finishCode = null;
    let codeRef = null;
    if (required) {
      // ONE record per (household, lesson, lessonDay) — the learner is dropped
      // on purpose, which is what makes two siblings share one code, and
      // `companionLessonDay` is clock-free, which is what makes a catch-up next
      // week inherit it rather than earn a second one. See that helper.
      // Derived ONCE. The key and the record body must agree about the day or
      // the record files itself where no later lookup finds it; computing it
      // twice makes that agreement a convention rather than a fact.
      const lessonDay = companionLessonDay(unit, instance.lessonId);
      codeRef = this.#companionCodes.keyFor({
        householdId: this.#householdId,
        lessonId: instance.lessonId,
        lessonDay,
      });
      // SYNCHRONOUS by contract: the store's `findOrCreate` is indivisible from
      // its existence check to its write only because nothing inside `create`
      // awaits, and an async `create` would hand it a Promise to serialise.
      // Passing a function rather than a value is also what lets the caller
      // that loses the race never draw a code at all.
      const record = await this.#companionCodes.findOrCreate({
        key: codeRef,
        create: () => ({
          schema: COMPANION_CODE_SCHEMA,
          id: codeRef,
          householdId: this.#householdId,
          lessonId: instance.lessonId,
          lessonDay,
          code: mintCode({ rng: this.#rng }),
          // How many pieces of the companion must be covered before the code is
          // released, RESOLVED TO A COUNT here and frozen with the code: the
          // record is what grades a sheet already in a child's hand, so a
          // reading that gains a chapter next week must not move the gate under
          // paper that has already printed.
          //
          // Authored as `companion.requireParts` — a number, or `'all'`, which
          // only becomes a number once the playlist is resolved (which is here).
          // Unauthored means all of them, which is what this minted before the
          // field existed.
          requireParts: resolveRequireParts(configured.requireParts, companion.payload?.playlist?.parts?.length),
          createdAt: nowIso,
          satisfiedAt: null,
          satisfiedBy: null,
          satisfiedVia: null,
          coverage: {},
        }),
      });
      // `code` inside the store, `finishCode` at this boundary — see the header.
      finishCode = record.code;
      // A FOUND record is not necessarily a usable one. The store validates
      // shape and identity, never `code`, so a truncated or hand-edited YAML
      // whose `code:` key is missing or null reads back cleanly — and `null` is
      // the in-band value meaning "optional, print no gate". The renderer's own
      // guard cannot catch it (`finishCode != null` is false there) and it has
      // no way to know the companion was required, so a required lesson would
      // print an UNGATED sheet with no error anywhere: a child passes without
      // the media, which is the one outcome this feature exists to prevent.
      // Only this method knows `required`, and it already owns a refusal
      // envelope for exactly this class of problem.
      if (!formatCode(finishCode)) {
        this.#logger.warn?.('school.issue.companion-code-unusable', {
          sessionId: instance.sessionId, lessonId: instance.lessonId, codeRef,
        });
        return {
          refusal: {
            reason: 'companion-code-unusable',
            message: 'This lesson needs a read-along that is not ready. Tell a grown-up.',
          },
        };
      }
    }

    const live = await this.#tokens.liveAccessCodes();
    const accessCode = mintAccessCode({ rng: this.#rng, taken: (code) => live.has(code) });
    const id = `ral_${shortId(12)}`;
    const expiresAt = new Date(Date.parse(nowIso) + 7 * 24 * 3_600_000).toISOString();
    const accessCodeExpiresAt = required
      ? expiresAt
      : new Date(studyDayWindow(Date.parse(nowIso), { timezone: this.#timezone, boundaryHour: 4 }).endAtMs).toISOString();
    const token = mintToken({
      tokenClass: 'worksheet_companion',
      subject: { learnerId: instance.learnerId, sessionId: instance.sessionId, worksheetInstanceId: instance.id, lessonId: instance.lessonId, companionId: id },
      at: nowIso, expiresAt, accessCode, accessCodeExpiresAt, rng: this.#rng,
    });
    await this.#companions.put({
      schema: 'school.lesson-companion/v1', id, createdAt: nowIso,
      learnerId: instance.learnerId, sessionId: instance.sessionId, worksheetInstanceId: instance.id,
      lessonId: instance.lessonId,
      // The scope key, not the code: this record is per-learner, the code is
      // per-household, and copying the letters here would give the two places
      // to drift apart. Task 9 updates satisfaction through this reference.
      ...(codeRef ? { codeRef } : {}),
      companion, participation: configured.participation ?? 'optional', state: {},
    });
    await this.#tokens.put(token);
    return { accessCode, finishCode, codeRef };
  }

  async #lessonProgress({ state, unit, nowIso }) {
    if (!unit?.courseId || typeof this.#curriculum.listUnits !== 'function'
      || typeof this.#sessions.listForLearner !== 'function') return null;
    const [assignment, units, sessions, works] = await Promise.all([
      this.#assignments.get(state.learnerId), this.#curriculum.listUnits(),
      this.#sessions.listForLearner(state.learnerId), this.#curriculum.listWorks?.() ?? [],
    ]);
    return lessonProgressRows({ learnerId: state.learnerId, unit, assignment, units, sessions, works, now: nowIso });
  }

  /**
   * One token per action block whose `action` names a token class. A block
   * naming anything else is left alone — a document may carry a literal
   * instruction that is not a ticket — but a block that DOES name one gets a
   * real, resolvable code, because a barcode printed on a sheet a child is
   * holding must never scan to nothing.
   *
   * `media_action` counts as well as `scan_action`: the "play this" box on a
   * worksheet is scanned exactly like the "another copy" box beside it.
   */
  async #mintSheetTokens(document, sessionId, nowIso) {
    const wanted = new Set();
    walkBlocks(document.blocks, (block) => {
      const isAction = block.type === 'scan_action' || block.type === 'media_action';
      if (isAction && TOKEN_CLASSES.includes(block.action)) wanted.add(block.action);
    });
    const tokens = {};
    for (const tokenClass of wanted) {
      const record = mintToken({ tokenClass, subject: { sessionId }, at: nowIso, rng: this.#rng });
      // eslint-disable-next-line no-await-in-loop
      await this.#tokens.put(record);
      tokens[tokenClass] = record.token;
    }
    return tokens;
  }

  /**
   * Tracked quizzes through the SAME machinery a legacy worksheet uses (spec
   * §9): mint tokens, render, print, record — the identical SHAPE `execute`'s
   * legacy tail runs, just resolving the document via the print-document
   * repository and rendering via `RenderPrintDocument` with a fresh OMR card
   * allocation instead of the legacy `IDocumentRenderer`/form-map pair. Kept
   * as its own method (rather than folded into `execute`'s shared tail) so
   * the legacy path above stays exactly what it always was — nothing here can
   * perturb it.
   *
   * ALLOCATION RECORD TAKES THE FORM MAP'S SLOT (spec §9): a legacy unit
   * writes its form map AFTER a successful print, immediately BEFORE the
   * issue event — "the paper is out of the tray; the mapping must already be
   * durable" (module header). A card-attached render cannot defer ITS durable
   * write that late: the physical row numbers `RenderPrintDocument` prints on
   * the page ARE what `#allocateCard` persists (spec §5.3's numbering-is-the-
   * allocation invariant), so that write has to happen as part of producing
   * the bytes — before print, not after. That is STRICTLY EARLIER than the
   * legacy slot, which only strengthens the guarantee the ordering exists
   * for: nothing here can ever let a scan race a mapping that is not yet
   * durable. What occupies the code's own form-map-write branch below is
   * therefore a log line, not a write — the persistence already happened, in
   * the same role, before the sheet could physically reach a scanner.
   *
   * Exact reprints never reach this method: `execute()` reads retained bytes
   * before it selects an issuing branch. This branch exists only for an
   * initial print (including retry after a failure before an issue event), so
   * a fresh card is the only honest allocation.
   *
   * ORPHANED ALLOCATIONS ON A LATE FAILURE (Task 7 review, Finding 2): the
   * write-before-print ordering above means a fit rejection or a print jam
   * can both happen AFTER a card is already durably allocated. There is no
   * rollback of the write itself (see this method's own comment on why —
   * the paper-out-of-tray guarantee is about never letting a scan outrun a
   * mapping, not about erasing history), but leaving that record silently
   * `live` would burn a fresh physical card on every retry FOREVER, with no
   * way for anyone to even discover the stranded cardId. Both failure
   * branches below call `#orphanAllocation`, which logs the cardId/recordId
   * at `warn` (`school.issue.allocation-orphaned` — the ONE thing the
   * success-only `allocation-recorded` log never covers) and best-effort
   * releases it via the store (the same `release` a `release-card` CLI call
   * uses), so the very next retry's fresh allocation lands on a clean slate
   * instead of accumulating dead cards.
   */
  async #issuePrintDocument({
    sessionId, nowIso, state, unit, printRef, replacementArtifactId = null,
  }) {
    if (!this.#printDocuments || !this.#renderPrintDocument || !this.#allocationStore) {
      this.#logger.warn?.('school.issue.print-document-not-configured', {
        sessionId, unitId: state.unitId, document: unit.document,
      });
      return this.#unavailable(sessionId, 'no-document', 'There is no sheet to print for this one. Tell a grown-up.');
    }

    const published = await this.#printDocuments.getPublished(printRef.id, printRef.rev);
    if (!published) {
      // Mirrors the legacy "dangling reference" branch: should be impossible
      // at runtime once publish-time catalog validation covers print refs
      // too, so it is logged loudly as well as explained on paper.
      this.#logger.warn?.('school.issue.no-document', {
        sessionId, unitId: state.unitId, document: unit.document,
      });
      return this.#unavailable(sessionId, 'no-document', 'There is no sheet to print for this one. Tell a grown-up.');
    }

    const artifactId = replacementArtifactId ?? this.#newArtifactId();
    const tokens = await this.#mintSheetTokens(published, sessionId, nowIso);

    let rendered;
    try {
      const result = await this.#renderPrintDocument.execute({
        // The session's own `variant` overrides the published document's,
        // exactly like the legacy path below (`state.variant === (document.variant
        // ?? 0) ? document : {...}`) — a retry sheet must be the shuffle the
        // session actually asked for, not whatever the document was published
        // carrying.
        document: state.variant === (published.variant ?? 0)
          ? published : { ...published, variant: state.variant },
        context: {
          freshCard: true,
          learnerId: state.learnerId ?? null,
          // Session lineage (review wave B1): the allocation record is the
          // one durable artifact a card scan resolves — carrying the
          // sessionId here is what lets a graded scan advance THIS session
          // (submitted → graded) instead of dead-ending in a log line.
          sessionId,
          // F3 review fix (Medium/blocker): the tokens minted just above
          // (`#mintSheetTokens`) must reach `RenderPrintDocument`'s measure
          // + final render, or a scan_action/media_action block's barcode
          // prints its own `.action` literal — a dead code with no matching
          // registry entry — while the REAL minted token sits unused.
          tokens,
        },
      });
      rendered = {
        pdf: result.bytes, pageCount: result.pageCount, formMap: null, allocation: result.allocation,
        // Carried so the print job matches the geometry that was drawn — see
        // the `printPdf` call below.
        duplex: result.duplex,
      };
    } catch (err) {
      // A card may have been allocated and durably written before THIS
      // error fired (e.g. FIT_OVERSET, discovered only after `#allocateCard`
      // already ran) — `RenderPrintDocument` attaches that snapshot to
      // `err.details.allocation` for exactly this reason (see its own doc
      // comment). Absent for a failure that happened before any write (e.g.
      // ALLOCATION_STORE_REQUIRED/ALLOCATION_REQUIRES_REV), in which case
      // `#orphanAllocation` is a no-op.
      await this.#orphanAllocation(err.details?.allocation, { sessionId, unitId: state.unitId, stage: 'render' });
      return this.#recordFailure({
        sessionId, stage: 'render', reason: err.message, nowIso, state,
        cause: err.name === 'UnresolvedAssetError' ? 'missing_artwork' : 'render',
      });
    }

    rendered.pdf = await this.#retainIssuedPdf({
      artifactId, rendered, nowIso, sessionId, state, allocation: rendered.allocation,
      document: published,
      captureKind: replacementArtifactId ? 'replacement' : 'original',
    });
    let printResult;
    try {
      printResult = await this.#printer.printPdf(rendered.pdf, {
        jobName: `school-${state.unitId}-${artifactId}`,
        user: state.learnerId ?? 'daylight',
        // A tracked quiz is NOT a `worksheet` archetype, so its punch gutter is
        // fixed to the left of every page — printing it double-sided would put
        // page 2's margin on the opposite physical edge of the same sheet, and
        // punching the stack would eat the content on every verso. The render
        // reports which geometry it drew; the job follows it. `undefined` (v1
        // legacy documents, which draw no gutter) keeps the adapter default.
        duplex: rendered.duplex ?? undefined,
      });
    } catch (err) {
      // Render already succeeded here, so the allocation (if any) is right
      // on `rendered.allocation` — no error-detail plumbing needed for this
      // branch the way the render-failure one above needs it.
      await this.#orphanAllocation(rendered.allocation, { sessionId, unitId: state.unitId, stage: 'print' });
      return this.#recordFailure({ sessionId, stage: 'print', reason: err.message, nowIso, state, cause: 'printer' });
    }

    // Same slot the legacy path writes its form map in — see this method's
    // own doc comment on why the write itself already happened, earlier,
    // inside `renderPrintDocument.execute` above.
    if (rendered.allocation) {
      this.#logger.info?.('school.issue.allocation-recorded', {
        sessionId,
        unitId: state.unitId,
        artifactId,
        cardId: rendered.allocation.cardId,
        recordId: rendered.allocation.recordId,
        rowRange: rendered.allocation.rowRange,
      });
    }

    // `reprinted` (not `issued`) for a replacement — see `#issueNew`'s doc
    // comment: it is the only event legal from a session already in
    // `issued`/`reprinted` state.
    const type = replacementArtifactId ? 'reprinted' : 'issued';
    const { errors, event } = createEvent({
      type, at: nowIso, sessionId, artifactId, confirmed: this.#printConfirmed(printResult),
    });
    if (errors.length) throw new Error(`IssueDocument: could not record the issue: ${errors.join('; ')}`);
    await this.#sessions.appendEvent(sessionId, event);

    this.#logger.info?.('school.issue.printed', {
      sessionId, unitId: state.unitId, artifactId, reprint: false,
      replacement: Boolean(replacementArtifactId), pages: rendered.pageCount ?? null,
    });

    return {
      status: type,
      sessionId,
      artifactId,
      pageCount: rendered.pageCount ?? null,
      tokens,
      formMap: null,
      // Not on the legacy return shape (which has no card concept) — additive,
      // so a caller not yet reading it sees nothing new. Callers include
      // ResolveScanAction/receipts, none of which read this field today.
      allocation: rendered.allocation ?? null,
      document: null,
      message: replacementArtifactId
        ? 'The original of that sheet was not saved, so a fresh copy is being printed.'
        : 'Printing your sheet.',
    };
  }

  /**
   * Persist original bytes before physical dispatch.
   *
   * `captureKind` defaults to `'original'` — the first, byte-for-byte
   * retention of what actually went to the printer. A replacement fall-through
   * (`#issueNew`'s `replacementArtifactId` path, reached from `#reprintExact`
   * when the true original's bytes are gone) passes `'replacement'` instead:
   * this IS a fresh rendering, filed under the same artifactId to heal the
   * gap, and the manifest must say so rather than silently reading as if it
   * always was the original — that honesty is the whole point of the fix.
   */
  async #retainIssuedPdf({ artifactId, rendered, nowIso, sessionId, state,
    worksheetInstanceId = null, allocation = null, document = null, captureKind = 'original' }) {
    const renderedBytes = Buffer.isBuffer(rendered.pdf) ? rendered.pdf : Buffer.from(rendered.pdf);
    if (!this.#issuedArtifacts) return renderedBytes;
    const retained = await this.#issuedArtifacts.put({
      artifactId, bytes: renderedBytes, pageCount: rendered.pageCount ?? null,
      issuedAt: nowIso, sessionId, learnerId: state.learnerId, unitId: state.unitId,
      captureKind, worksheetInstanceId, allocation,
      kind: 'worksheet', document,
      renderContext: {
        learnerId: state.learnerId ?? null, sessionId,
        variant: state.variant ?? 0, passPercent: state.passingPercent ?? null,
        duplex: rendered.duplex ?? null,
      },
    });
    return retained.bytes;
  }

  /**
   * Best-effort cleanup for a card that was durably allocated but whose
   * render/print never completed (Task 7 review, Finding 2). `allocation`
   * is the `{cardId, rowRange, recordId, status}` snapshot — absent (no-op)
   * whenever nothing was actually written yet.
   *
   * Two things happen, and the FIRST never depends on the second: the
   * cardId/recordId are logged at `warn` unconditionally, because a grown-up
   * (or a future debugging session) needs to be able to find a stranded card
   * even if the release itself also fails — a silent release failure must
   * never also mean a silent orphan. `release` failing (e.g. the store is
   * unreachable) is itself logged, never thrown — this runs from inside an
   * already-failed issue attempt, and a SECOND failure here must not replace
   * the FIRST one in what gets reported back to the child.
   */
  async #orphanAllocation(allocation, { sessionId, unitId, stage }) {
    if (!allocation) return;
    this.#logger.warn?.('school.issue.allocation-orphaned', {
      sessionId, unitId, stage, cardId: allocation.cardId, recordId: allocation.recordId, rowRange: allocation.rowRange,
    });
    if (typeof this.#allocationStore?.release !== 'function') return;
    try {
      const released = await this.#allocationStore.release({ cardId: allocation.cardId, rows: allocation.rowRange });
      this.#logger.warn?.('school.issue.allocation-released', {
        sessionId, cardId: allocation.cardId, recordId: allocation.recordId, releasedCount: released.length,
      });
    } catch (err) {
      this.#logger.warn?.('school.issue.allocation-release-failed', {
        sessionId, cardId: allocation.cardId, recordId: allocation.recordId, error: err.message,
      });
    }
  }

  /**
   * Whether `lastPrintedAt` is still inside the debounce window. Pure
   * arithmetic on two ISO strings — no I/O, no clock read of its own, so a
   * test can assert it against any `nowIso` without waiting on a real timer.
   *
   * `lastPrintedAt: null` (nothing has ever successfully printed for this
   * session) always answers `false` — there is nothing to debounce against,
   * which is what lets the very first issue through unconditionally and lets
   * a retry after a print FAILURE through immediately (see the call site's
   * comment: a `failed` annotation never touches `lastPrintedAt`).
   */
  #withinPrintCooldown(lastPrintedAt, nowIso) {
    if (!lastPrintedAt) return false;
    const elapsedMs = Date.parse(nowIso) - Date.parse(lastPrintedAt);
    if (!Number.isFinite(elapsedMs)) return false;
    return elapsedMs < this.#printCooldownMinutes * 60_000;
  }

  /**
   * Whether a `printer.printPdf()` result represents a GENUINE physical
   * print, for the `confirmed` field threaded into the `issued`/`reprinted`
   * event (see `sessionEvents.mjs`'s SCHEMA comment on that field).
   *
   * The bug this exists to close: `printer.printPdf()` NOT throwing only
   * ever meant "the injected port accepted this call" — every one of this
   * class's three issuing branches already treated that as "the print
   * succeeded" and stamped the debounce timer from it, with no way to tell
   * a real laser-printer dispatch apart from a caller that deliberately
   * captures bytes instead of sending them anywhere (the `barcode-scan-sim`
   * CLI's own "dry run by default" printer double is exactly this — see its
   * `capturingPrinter` doc comment). A double built that way IS legitimate
   * (it is what makes "dry run unless `--print`" true for that tool without
   * turning IssueDocument's own printer-failure handling into dead code no
   * test ever exercises) — the bug was never that such a double should not
   * exist, only that arming a REAL debounce off it, silently, was wrong. A
   * real print that came out of the tray must debounce the next scan; a
   * simulator run that produced nothing must not block the next REAL print
   * for however many minutes the cooldown lasts.
   *
   * `printResult?.confirmed === false` is the ONLY way to opt out — every
   * existing adapter/double (`LaserPrinterAdapter`'s IPP/raw-9100 result
   * shapes, `FakeLaserPrinter`'s `{ok:true,...}`, anything that resolves
   * without ever mentioning `confirmed`) defaults to "yes, this was real,"
   * so this is purely additive: nothing that used to arm the cooldown stops
   * arming it just because this check exists.
   */
  #printConfirmed(printResult) {
    return printResult?.confirmed !== false;
  }

  /**
   * Record the failure as an ANNOTATION (state does not advance, so the ticket
   * in the child's hand stays valid) and hand back a slip with a fresh recovery
   * ticket. Never throws — §9's whole point is that a failed print is a retry,
   * not a dead end.
   *
   * The slip says which thing broke. A message that misidentifies the cause is
   * worse than none: "the printer is not answering" over a document that could
   * not be DRAWN sends a grown-up to check paper and cables while the real
   * problem — a missing diagram — sits in the curriculum, and every retry fails
   * the same way with the same wrong explanation.
   */
  async #recordFailure({ sessionId, stage, reason, nowIso, state, cause = 'printer' }) {
    const { event } = createEvent({ type: 'failed', at: nowIso, sessionId, stage, reason: reason || stage });
    if (event) await this.#sessions.appendEvent(sessionId, event);
    this.#logger.warn?.('school.issue.failed', { sessionId, stage, reason });

    let recovery = null;
    try {
      const record = mintToken({ tokenClass: 'recovery', subject: { sessionId }, at: nowIso, rng: this.#rng });
      await this.#tokens.put(record);
      recovery = record.token;
    } catch (err) {
      // A registry that cannot mint still must not swallow the failure notice.
      this.#logger.warn?.('school.issue.recovery-token-failed', { sessionId, error: err.message });
    }

    const copy = FAILURE_COPY[cause] ?? FAILURE_COPY.printer;
    return {
      status: copy.status,
      sessionId,
      artifactId: state.issuedArtifacts.at(-1) ?? null,
      pageCount: null,
      tokens: {},
      message: copy.message,
      document: noticeDocument({
        id: `${copy.slipId}-${sessionId}`,
        headline: copy.headline,
        lines: copy.lines,
        actions: recovery ? [{ token: recovery, label: copy.actionLabel }] : [],
      }),
    };
  }

  #unavailable(sessionId, id, line) {
    return {
      status: 'unavailable',
      sessionId: sessionId ?? null,
      artifactId: null,
      pageCount: null,
      tokens: {},
      message: line,
      document: noticeDocument({
        id: `${id}-${sessionId ?? 'none'}`,
        headline: 'We could not print that',
        lines: [line, 'Scan your card for a new list.'],
      }),
    };
  }
}

export default IssueDocument;
