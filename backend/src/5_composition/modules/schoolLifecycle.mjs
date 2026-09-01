// backend/src/5_composition/modules/schoolLifecycle.mjs
//
// Composition wiring for the School physical console (spec §2, §6.2, §9).
//
// This is the only file that names concrete adapters for the lifecycle: the use
// cases take ports, and the choice between a real printer and a double belongs
// here (decision D1). It returns everything `app.mjs` needs — the scan handler
// for the relay branch, the reporter for the parent board, and the routers.
//
// FAIL CLOSED, TWICE:
//
//  1. The virtual devices are wired ONLY when `school.yml` says
//     `virtualDevices: true` (default false). A production deployment must not
//     be able to reach "make the printer fail", even by guessing a path.
//  2. The lifecycle needs a document renderer, which is a `1_rendering` module
//     the application layer may not import. If that module is not present, the
//     whole lifecycle stays unwired and says so at boot — rather than mounting
//     routes that would fail at the moment a child scans a card.
//
// The doubles are constructed ONCE and shared between the lifecycle use cases
// and the virtual device console. Two instances would mean the console showing
// an empty tray while `IssueDocument` printed happily into a different one.
//
// WHERE ARTWORK LIVES: `<dataDir>/content/assets/<ref>.svg`.
//
// A document's `asset` block carries a bare ref (`school/math/fraction-strips`)
// and nothing about where it is — that is deployment knowledge, and it is
// resolved here. Refs are already namespaced by subsystem, which is why the root
// is `content/assets` and not `content/school/assets`: one tree, and the ref's
// first segment says whose it is. Curriculum YAML sits beside it under
// `content/school/<subject>/<course>/`.
//
// Shipping with NO resolver (which is what this file used to do) meant the
// renderer's default one threw on every sheet carrying a diagram, `IssueDocument`
// recorded a failure, and the child was handed a slip saying the printer was not
// answering — false, and no amount of retrying could clear it.

import path from 'path';
import { DocumentRendererAdapter, ReceiptRendererAdapter } from '#adapters/school/documents/DocumentRendererAdapter.mjs';
import { RetainedReceiptPrinter } from '#adapters/school/documents/RetainedReceiptPrinter.mjs';
import { ReceiptPngArtifactRenderer } from '#adapters/school/documents/ReceiptPngArtifactRenderer.mjs';
import { UnavailableSchoolMediaDispatcher } from '#adapters/school/UnavailableSchoolMediaDispatcher.mjs';
import { SchoolServiceBankReader } from '#adapters/school/SchoolServiceBankReader.mjs';
import { SchoolTeacherConfigSource } from '#adapters/school/SchoolTeacherConfigSource.mjs';
import { HouseholdSchoolRoster } from '#adapters/school/HouseholdSchoolRoster.mjs';
import { YamlCurriculumDatastore } from '#adapters/persistence/yaml/YamlCurriculumDatastore.mjs';
import { YamlFitnessCourseProjectionStore } from '#adapters/persistence/yaml/YamlFitnessCourseProjectionStore.mjs';
import { YamlWorkSessionDatastore } from '#adapters/persistence/yaml/YamlWorkSessionDatastore.mjs';
import { YamlTokenRegistry } from '#adapters/persistence/yaml/YamlTokenRegistry.mjs';
import { YamlAssignmentStore } from '#adapters/persistence/yaml/YamlAssignmentStore.mjs';
import { YamlSyllabusStore } from '#adapters/persistence/yaml/YamlSyllabusStore.mjs';
import { YamlTimingAnchorStore } from '#adapters/persistence/yaml/YamlTimingAnchorStore.mjs';
import { YamlFormMapStore } from '#adapters/persistence/yaml/YamlFormMapStore.mjs';
import { YamlWorksheetInstanceStore } from '#adapters/persistence/yaml/YamlWorksheetInstanceStore.mjs';
import { YamlLessonCompanionStore } from '#adapters/persistence/yaml/YamlLessonCompanionStore.mjs';
import { YamlCompanionCodeStore } from '#adapters/persistence/yaml/YamlCompanionCodeStore.mjs';
import { YamlIssuedArtifactStore } from '#adapters/persistence/yaml/YamlIssuedArtifactStore.mjs';
import { YamlReviewQueue } from '#adapters/persistence/yaml/YamlReviewQueue.mjs';
import { YamlAgendaCooldownStore } from '#adapters/persistence/yaml/YamlAgendaCooldownStore.mjs';
import { YamlReadingLogStore } from '#adapters/persistence/yaml/YamlReadingLogStore.mjs';
import { YamlTeacherActionReceiptStore } from '#adapters/persistence/yaml/YamlTeacherActionReceiptStore.mjs';
import { YamlPrintDocumentRepository } from '#adapters/school/documents/YamlPrintDocumentRepository.mjs';
import { YamlAllocationStore } from '#adapters/school/documents/YamlAllocationStore.mjs';
import { YamlHeldCardScanStore } from '#adapters/school/documents/YamlHeldCardScanStore.mjs';
import { RenderPrintDocument } from '#apps/school/documents/RenderPrintDocument.mjs';
import { ResolveCardScan } from '#apps/school/documents/ResolveCardScan.mjs';
import { ReviewHeldCardScan } from '#apps/school/documents/ReviewHeldCardScan.mjs';
import { createYamlBankReader } from '#adapters/school/documents/YamlBankReader.mjs';
import { CurriculumAccess } from '#apps/school/CurriculumAccess.mjs';
import { PlanProjection } from '#apps/school/PlanProjection.mjs';
import { FitnessCourseCurriculumCatalog } from '#apps/school/FitnessCourseCurriculumCatalog.mjs';
import { FitnessSchoolAssessmentBridge } from '#apps/school/FitnessSchoolAssessmentBridge.mjs';
import { EventBusSchoolRealtimeAdapter } from '#adapters/eventbus/EventBusSchoolRealtimeAdapter.mjs';
import { GrownUpGate } from '#apps/school/GrownUpGate.mjs';
import { ReceiptPrinting } from '#apps/school/ReceiptPrinting.mjs';
import { SentenceLadderProgramLauncher } from '#apps/school/SentenceLadderProgramLauncher.mjs';
import { LanguageReelsProgramLauncher } from '#apps/school/LanguageReelsProgramLauncher.mjs';
import { FlashcardProgramLauncher } from '#apps/school/FlashcardProgramLauncher.mjs';
import { RubiksCubeProgramLauncher } from '#apps/school/RubiksCubeProgramLauncher.mjs';
import { RUBIKS_CUBE_COURSE_ID } from '#apps/school/rubiksCube/courseCatalog.mjs';
import { createSchoolProgramEnrollmentValidators } from '#apps/school/SchoolProgramEnrollmentValidators.mjs';
import { SchoolSurfaceValidatorCatalog } from '#apps/school/SchoolSurfaceValidatorCatalog.mjs';
import { createSchoolSessionId } from '#apps/school/SchoolSessionIdentityPolicy.mjs';
import { PreviewSchoolSessionStore, PreviewSchoolTokenRegistry } from '#apps/school/PreviewSchoolStores.mjs';
import { SyllabusManagementService } from '#apps/school/SyllabusManagementService.mjs';
import { SurfaceProgramLauncher } from '#apps/school/SurfaceProgramLauncher.mjs';
import { StoryTimeProgramLauncher } from '#apps/school/StoryTimeProgramLauncher.mjs';
import { PianoCourseProgramLauncher } from '#apps/school/PianoCourseProgramLauncher.mjs';
import { PianoLessonCeremonyBridge } from '#apps/school/PianoLessonCeremonyBridge.mjs';
import { DoNowSchoolBridge } from '#apps/school/DoNowSchoolBridge.mjs';
import { CloseLanguageDay } from '#apps/school/CloseLanguageDay.mjs';
import { GetLearnerDayCompletion } from '#apps/school/GetLearnerDayCompletion.mjs';
import { SchoolCompletionBridge } from '#apps/school/SchoolCompletionBridge.mjs';
import { WorkSessionReporter } from '#apps/school/WorkSessionReporter.mjs';
import { BuildAgenda } from '#apps/school/usecases/BuildAgenda.mjs';
import { TeacherAgendaDispatch } from '#apps/school/usecases/TeacherAgendaDispatch.mjs';
import { ListLearnerSessions } from '#apps/school/usecases/ListLearnerSessions.mjs';
import { ListPrintableWorksheetSessions } from '#apps/school/usecases/ListPrintableWorksheetSessions.mjs';
import { makeTeacherGate } from '#apps/school/TeacherGate.mjs';
import { YamlPassOverrideStore } from '#adapters/persistence/yaml/YamlPassOverrideStore.mjs';
import { YamlAttestationLog } from '#adapters/persistence/yaml/YamlAttestationLog.mjs';
import { YamlTeacherNotes } from '#adapters/persistence/yaml/YamlTeacherNotes.mjs';
import { IssueDocument } from '#apps/school/usecases/IssueDocument.mjs';
import { IssueComposedWorksheet } from '#apps/school/usecases/IssueComposedWorksheet.mjs';
import { DispatchMedia } from '#apps/school/usecases/DispatchMedia.mjs';
import { RecordMediaCompletion } from '#apps/school/usecases/RecordMediaCompletion.mjs';
import { SubmitPaperWork } from '#apps/school/usecases/SubmitPaperWork.mjs';
import { GradeSubmission } from '#apps/school/usecases/GradeSubmission.mjs';
import { CloseSessionOutcome } from '#apps/school/usecases/CloseSessionOutcome.mjs';
import { CaptureResultReceiptArtifact } from '#apps/school/usecases/CaptureResultReceiptArtifact.mjs';
import { ReprintResultReceiptArtifact } from '#apps/school/usecases/ReprintResultReceiptArtifact.mjs';
import { IssueCorrectedResultReceipt } from '#apps/school/usecases/IssueCorrectedResultReceipt.mjs';
import { OpenRemediation } from '#apps/school/usecases/OpenRemediation.mjs';
import { ReplaceRemediation } from '#apps/school/usecases/ReplaceRemediation.mjs';
import { InvalidateSessionEvidence } from '#apps/school/usecases/InvalidateSessionEvidence.mjs';
import { RecoverMisattributedWorksheet } from '#apps/school/usecases/RecoverMisattributedWorksheet.mjs';
import { ResolvePersonalCard } from '#apps/school/usecases/ResolvePersonalCard.mjs';
import { ResolveScanAction } from '#apps/school/usecases/ResolveScanAction.mjs';
import { ResolveSubjectNext } from '#apps/school/usecases/ResolveSubjectNext.mjs';
import { ResolveAccessCode } from '#apps/school/usecases/ResolveAccessCode.mjs';
import { RunSelfServiceAction } from '#apps/school/usecases/RunSelfServiceAction.mjs';
import { RecordLessonCompanionProgress } from '#apps/school/usecases/RecordLessonCompanionProgress.mjs';
import { GetCompanionFinishCode } from '#apps/school/usecases/GetCompanionFinishCode.mjs';
import { ReadPrinterHealth } from '#apps/school/usecases/ReadPrinterHealth.mjs';
import { LessonCompanionHandlers, ReadalongLessonCompanionHandler } from '#apps/school/companions/LessonCompanionHandlers.mjs';
import { ResolveReviewItem } from '#apps/school/usecases/ResolveReviewItem.mjs';
import { SetAssignments } from '#apps/school/usecases/SetAssignments.mjs';
import { MarkSessionAbandoned } from '#apps/school/usecases/MarkSessionAbandoned.mjs';
import { ReplaceLostAnswerSheet } from '#apps/school/usecases/ReplaceLostAnswerSheet.mjs';
import { CreateLostAnswerSheetTicket } from '#apps/school/usecases/CreateLostAnswerSheetTicket.mjs';
import { EnrollLearner } from '#apps/school/usecases/EnrollLearner.mjs';
import { UnenrollLearner } from '#apps/school/usecases/UnenrollLearner.mjs';
import { STORY_TIME_PROGRAM_ID } from '#domains/school/storyTime.mjs';
import { validateFitnessActivityDescriptor } from '#domains/school/fitnessCourse.mjs';
import { isSchoolToken } from '#domains/school/sessions/tokens.mjs';
import { createSchoolLifecycleRouter } from '#api/v1/routers/schoolLifecycle.mjs';
import { SchoolLifecycleAgendaResource } from '#apps/school/services/SchoolLifecycleAgendaResource.mjs';
import { SchoolLifecycleReadService } from '#apps/school/services/SchoolLifecycleReadService.mjs';
import { SchoolLifecycleSyllabusService } from '#apps/school/services/SchoolLifecycleSyllabusService.mjs';
import { VirtualSchoolDeviceConsole } from '#apps/school/services/VirtualSchoolDeviceConsole.mjs';
import { createSchoolVirtualDevicesRouter } from '#api/v1/routers/schoolVirtualDevices.mjs';
import { createSchoolSelfServiceRouter } from '#api/v1/routers/school.selfservice.mjs';

/**
 * Tokens are printed and carried around a house; a predictable stream would let
 * one child's ticket be guessed from another's. `crypto.randomUUID` is seeded
 * from the platform CSPRNG, so this draw is too — and it stays an injected
 * function, which is what keeps the domain pure and the tests deterministic.
 */
function cryptoRng(crypto) {
  return () => {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] / 2 ** 32;
  };
}

/**
 * @param {object} deps
 * @param {object} deps.configService
 * @param {string|null} [deps.householdId]
 * @param {object} deps.schoolService - the existing grading engine + bank reader
 * @param {object} [deps.economyService]
 * @param {object} [deps.userService]
 * @param {object} [deps.languageStudyService] - the sentence-ladder program (Task 8/12).
 *   Present means the `language` program is a live launcher, reachable from a
 *   `subject_next` ticket the same as any curriculum unit; absent means the
 *   `launchers` map stays empty and no program entry can ever resolve.
 * @param {object} [deps.eventBus]
 * @param {object} [deps.thermalPrinterRegistry] - the house receipt-printer registry
 * @param {object} [deps.playbackAdapter] - an already-built playback target.
 *   Normally absent: with `wakeScreen` and at least one configured
 *   `media.targets` entry this module builds the real `ScreenPlaybackAdapter`
 *   itself (§8). Passing one overrides that — the seam a test or a future
 *   headset target uses to substitute its own.
 * @param {(a: {target: string, location: string}) => Promise<{ok: boolean}>} [deps.wakeScreen]
 *   - power a room's display on and bring the kiosk forward, and nothing else.
 *   The SAME closure the reading path is wired with (`app.mjs`), deliberately:
 *   it is NOT `WakeAndLoadService`, because that ends in a content load and a
 *   content load reloads the page, dropping the WebSocket the lesson is about
 *   to be announced on. School does not wake screens itself; it hands this to
 *   `ScreenPlaybackAdapter`. Absent means no real playback target, and the
 *   media leg degrades as it always has.
 * @param {object} [deps.donow] - the REAL, household-level `DoNowService`
 *   (Task 13's own `5_composition/modules/donow.mjs`, constructed in
 *   `app.mjs` AFTER the seams every surface needs — `wakeAndLoadService`,
 *   home-automation adapters, the playback-hub container). School is one
 *   CONSUMER of it, like any other caller — this file builds no DoNowService
 *   of its own. Absent (a test harness, or app.mjs's own donow wiring
 *   failing) degrades every `launch:`/`program:` path to "Ask a grown-up to
 *   set this up." rather than throwing (ResolveScanAction/SurfaceProgramLauncher's
 *   own optional-degrading design).
 * @param {Map<string, object>} [deps.donowSurfaces] - the SAME surface-id ->
 *   adapter Map `donow` dispatches through, so curriculum `launch:` blocks
 *   validate against the real registered adapters (`CurriculumAccess`'s
 *   `surfaceValidators`) rather than a separately-derived one that could drift.
 * @param {object} [deps.donowDatastore] - `donow`'s own `YamlDoNowDatastore`
 *   (`listDispatches({dayStamp})`) — `SurfaceProgramLauncher.status()`'s
 *   evidence source, shared rather than a second store pointed at the same files.
 * @param {() => Date} [deps.clock] - the ONE clock the whole lifecycle reads.
 *   Grace windows, token expiry and the UTC day boundary of a payout are all
 *   decided from it, so nothing downstream calls `Date.now()` and a test states
 *   the time rather than waiting for it. Defaults to the wall clock.
 * @param {() => number} [deps.rng] - draws in [0,1) for token minting. Defaults
 *   to the platform CSPRNG; a caller passes a seeded one only to make a run
 *   reproducible.
 * @param {object} [deps.logger]
 * @param {object} [deps.tokenRegistry] shared School token registry
 * @param {object} [deps.schoolCalcActionResolver] device-bound lesson-action resolver
 * @param {object} [deps.schoolCalcStudies] Adaptive Study issuance service
 * @returns {Promise<{
 *   wired: boolean, reason: string|null,
 *   handlesCode: (code: string) => boolean,
 *   handleScan: ((args: {code: string, device?: string}) => Promise<object>)|null,
 *   reporter: object|null, router: object|null, devicesRouter: object|null,
 *   useCases: object, stores: object, devices: object, renderers: object,
 * }>}
 */
export async function createSchoolLifecycle({
  configService, householdId = null, schoolService,
  attemptDatastore = null,
  economyService = null, userService = null, eventBus = null, realtime = null,
  thermalPrinterRegistry = null, playbackAdapter = null, wakeScreen = null,
  startReadingSession = null,
  languageStudyService = null,
  studyGrants = null,
  languageReelService = null,
  languageReelGrants = null,
  // Piano's `GetPlayableUnits` use case, injected so the piano-course program
  // reads the SAME course/progress/lock projection the kiosk itself renders.
  // Null in a composition without Piano: the program simply never registers.
  pianoPlayableUnits = null,
  // Durable alternate evidence for configured School PianoChallenges. It is
  // injected from Piano's application layer; School only consumes its port.
  schoolPianoChallengeCompletionService = null,
  fitnessPlayableService = null,
  fitnessSchoolCourseService = null,
  learningEvidenceRepository = null,
  learnerDirectory = null,
  // `SchoolGradingHookAdapter` bound to `piano_lesson_hook`; null with no HA.
  pianoLessonHook = null,
  flashcardStudyService = null,
  rubiksCubeService = null,
  rubiksCubeGrants = null,
  donow = null, donowSurfaces = null, donowDatastore = null,
  tokenRegistry = null, schoolCalcActionResolver = null, schoolCalcStudies = null,
  // A THUNK returning every `learner_action` the household's trigger sources
  // declare (or `null` when they could not be read). A function, not a value,
  // because this module is composed before the trigger API that owns the
  // parsed sources — see `PlanProjection#resolveDeclaredEntryActions`. Omitted
  // means the reachability question is not asked at all, which is the
  // behaviour every composition had before 2026-08-26.
  declaredEntryActions = undefined,
  clock = () => new Date(), rng = null, logger = console,
} = {}) {
  const schoolRealtime = realtime ?? (eventBus ? new EventBusSchoolRealtimeAdapter({ eventBus }) : null);
  const realtimeSubscriptionsAvailable = realtime != null || typeof eventBus?.subscribe === 'function';
  const cfg = configService.getHouseholdAppConfig?.(householdId, 'school') || {};
  const lifecycleCfg = cfg.lifecycle || {};
  const dataDir = configService.getDataDir();

  const inert = (reason) => {
    logger.info?.('school.lifecycle.unwired', { reason });
    return {
      wired: false, reason, handlesCode: () => false, handleScan: null,
      reporter: null, router: null, devicesRouter: null, selfServiceRouter: null,
      useCases: {}, stores: {}, devices: {}, renderers: {}, launchers: new Map(),
      donowSchoolBridge: null, grownUps: null, teacherGate: null, passOverrides: null,
    };
  };

  if (lifecycleCfg.enabled !== true) return inert('lifecycle.enabled is not true in school.yml');

  // --- hardware --------------------------------------------------------------
  const useVirtual = (cfg.virtualDevices ?? lifecycleCfg.virtualDevices) === true;
  const captureRoot = configService.getHouseholdPath('school/artifacts/captures');

  // --- rendering (the one dependency the application layer cannot import) ----
  let documentRenderer = null;
  let printDocumentRendering = null;
  let receiptRenderer = null;
  let schoolAssetResolver = null;
  try {
    const { createDocumentPdfRenderer } = await import('#rendering/school/documents/DocumentPdfRenderer.mjs');
    const { createSchoolAssetResolver } = await import('#adapters/school/documents/FilesystemSchoolAssetResolver.mjs');
    const { createPrintDocumentRendering } = await import('#rendering/school/documents/PrintDocumentRendering.mjs');
    const resolveAsset = createSchoolAssetResolver({
      rootDir: cfg.assets?.dir || path.join(dataDir, 'content', 'assets'),
      logger,
    });
    schoolAssetResolver = resolveAsset;
    printDocumentRendering = createPrintDocumentRendering({ resolveAsset });
    // Already the `IDocumentRenderer` shape: `render(document, opts)` →
    // `{pdf, pageCount, formMap}`. No adaptation needed, and none invented.
    documentRenderer = new DocumentRendererAdapter({
      renderer: createDocumentPdfRenderer({
        resolveAsset,
      }),
    });
  } catch (err) {
    // No renderer, no console. Mounting routes that would fail at the moment a
    // child scans a card is worse than not mounting them.
    return inert(`document renderer unavailable: ${err.message}`);
  }

  try {
    // The text/barcode receipt renderer. It no longer reaches paper directly
    // for the three receipts this console prints (see `receiptPrintRenderer`
    // below) — it now backs the raster path, as the source of the operator
    // transcript and as the fallback when rasterizing fails.
    //
    // THIS USED TO BE THE PRIMARY PATH, on the reasoning that the canvas
    // renderer's receipt drew an empty square where the code belonged. That
    // was true when the symbology was Code128 and false the moment
    // `DocumentReceiptRenderer` grew a real QR encoder (`scanCodes:'qr'`,
    // which the raster path below always requests): the canvas has drawn a
    // genuinely scannable code for a while, and printing plain text items
    // instead was solving a problem that no longer existed while leaving the
    // designed receipt layout — the one the print-design system exists to
    // produce — permanently unreached. The one part of that old reasoning
    // that was never stale is that an ESC/POS `{type:'image'}` item carries
    // no decodable text of its own, so a pure raster job leaves the printer's
    // operator transcript empty. That is solved below by running THIS
    // renderer alongside the raster one (never printed) purely to harvest its
    // words as `transcript`/`codes` — see `DocumentReceiptRasterRenderer.mjs`
    // for the full accounting.
    const { createDocumentEscPosRenderer } = await import('#rendering/school/documents/DocumentEscPosRenderer.mjs');
    // QR, not Code128: the school console's tickets are minted and re-derived
    // through this one renderer, and a QR is what a phone-shaped scanner in a
    // household reads back reliably at receipt-tape width.
    receiptRenderer = createDocumentEscPosRenderer({ symbology: 'QR' });
  } catch (err) {
    // A missing receipt renderer is survivable: worksheets still print, and
    // `ReceiptPrinting` reports every receipt as unprinted rather than lying.
    logger.warn?.('school.lifecycle.no-receipt-renderer', { error: err.message });
  }

  // The designed receipt: `DocumentReceiptRenderer`'s canvas, rasterized to
  // the ESC/POS image job `receipts` (below) actually prints — the SAME
  // renderer the `.../agenda/preview` route uses, so a parent previewing an
  // agenda and a child holding the printed one see the identical layout.
  // Built here, ABOVE `receipts`'s construction, because `ReceiptPrinting`
  // takes its renderer at construction time: this was a real ordering bug,
  // not a style preference — `receiptPngRenderer` used to exist only after
  // `receipts` did, which made wiring it in structurally impossible without
  // moving this block. Optional like `receiptRenderer` above: a missing
  // `qrcode`/`canvas`/`resvg` dependency degrades the receipt/preview surface,
  // not the whole console.
  let receiptPngRenderer = null;
  try {
    const { createDocumentReceiptRenderer } = await import('#rendering/school/documents/DocumentReceiptRenderer.mjs');
    receiptPngRenderer = createDocumentReceiptRenderer({
      scanCodes: 'qr',
      resolveSubjectIcon: schoolAssetResolver,
    });
  } catch (err) {
    logger.warn?.('school.lifecycle.no-receipt-png-renderer', { error: err.message });
  }

  // `ReceiptPrinting`'s actual renderer: the raster receipt when it can be
  // built, wrapping `receiptRenderer` for its transcript/fallback duties (see
  // `DocumentReceiptRasterRenderer.mjs`); otherwise `receiptRenderer` alone,
  // the same text-only behaviour this console shipped with before this PNG
  // wiring existed. `null` only when BOTH renderer imports failed, which
  // leaves `receipts.wired` false and every receipt reporting `not_wired`
  // rather than throwing (`ReceiptPrinting`'s own contract).
  let receiptPrintRenderer = receiptRenderer;
  if (receiptPngRenderer) {
    const { createDocumentReceiptRasterRenderer } = await import('#adapters/school/documents/DocumentReceiptRasterAdapter.mjs');
    receiptPrintRenderer = createDocumentReceiptRasterRenderer({
      canvasRenderer: receiptPngRenderer,
      escPosRenderer: receiptRenderer,
      logger,
    });
  }
  if (receiptPrintRenderer) {
    receiptPrintRenderer = new ReceiptRendererAdapter({ renderer: receiptPrintRenderer });
  }

  const devices = {};
  let laserPrinter = null;
  let receiptPrinter = null;
  let playback = null;

  if (useVirtual) {
    const [
      { VirtualLaserPrinterAdapter }, { VirtualThermalPrinterAdapter },
      { VirtualScannerAdapter }, { VirtualPlaybackAdapter }, { VirtualOmrReader },
    ] = await Promise.all([
      import('#adapters/hardware/laser-printer/VirtualLaserPrinterAdapter.mjs'),
      import('#adapters/hardware/thermal-printer/VirtualThermalPrinterAdapter.mjs'),
      import('#adapters/hardware/scanner/VirtualScannerAdapter.mjs'),
      import('#adapters/hardware/playback/VirtualPlaybackAdapter.mjs'),
      import('#adapters/hardware/omr/VirtualOmrReader.mjs'),
    ]);
    devices.laserPrinter = new VirtualLaserPrinterAdapter({
      captureDir: path.join(captureRoot, 'laser'), logger,
      // Same two knobs, same defaults as the real adapter below — a
      // `duplex: false` deployment must be reproducible against the double,
      // or the captures tell a story the paper would not.
      duplex: cfg.printing?.duplex ?? true,
      binding: cfg.printing?.binding || 'LONGEDGE',
    });
    devices.thermalPrinter = new VirtualThermalPrinterAdapter(
      { captureDir: path.join(captureRoot, 'thermal') }, { logger },
    );
    if (eventBus) {
      devices.scanner = new VirtualScannerAdapter({ eventBus, logger });
      devices.playback = new VirtualPlaybackAdapter({
        eventBus, targets: (lifecycleCfg.media?.targets || []).map((t) => t.id).filter(Boolean), logger,
      });
    }
    devices.omrReader = new VirtualOmrReader({ eventBus, logger });
    laserPrinter = devices.laserPrinter;
    receiptPrinter = devices.thermalPrinter;
    playback = devices.playback;
    logger.warn?.('school.lifecycle.virtual-devices', { captureRoot, devices: Object.keys(devices) });
  } else {
    const { LaserPrinterAdapter } = await import('#adapters/hardware/laser-printer/LaserPrinterAdapter.mjs');
    const printerHost = cfg.printing?.host || configService.getDeviceConfig?.('kitchen-printer')?.host || null;
    if (!printerHost) return inert('no laser printer host configured (school.yml printing.host)');
    laserPrinter = new LaserPrinterAdapter({
      host: printerHost,
      port: cfg.printing?.port || 631,
      path: cfg.printing?.path || '/ipp/print',
      // Resolved IDENTICALLY to app.mjs's PrintService adapter (the other
      // construction site). This is the adapter `IssueDocument` and
      // `ReplaceLostAnswerSheet` print through — i.e. every tracked worksheet
      // and quiz — so a `printing.duplex: false` that reached only the other
      // site would leave the paper path an operator actually cares about
      // untouched, with nothing logged to say so.
      duplex: cfg.printing?.duplex ?? true,
      binding: cfg.printing?.binding || 'LONGEDGE',
      logger,
    });
    // The thermal registry is built elsewhere in the composition root, so the
    // lifecycle asks it for whichever printer `school.yml` names rather than
    // standing up a second adapter against the same host. With no receipt
    // printer the console still runs: worksheets print, and every receipt
    // reports itself unprinted instead of pretending.
    const receiptLocation = lifecycleCfg.receiptPrinter ?? null;
    if (thermalPrinterRegistry) {
      try {
        receiptPrinter = thermalPrinterRegistry.resolve(receiptLocation ?? undefined);
      } catch (err) {
        logger.warn?.('school.lifecycle.no-receipt-printer', { location: receiptLocation, error: err.message });
      }
    }
    // Real playback dispatch (§8). An explicitly injected `playbackAdapter`
    // always wins — that is the seam a future headset target substitutes
    // through. Otherwise, if the house can wake a screen and school.yml names
    // any media target, build the real screen adapter here: it is the ONE
    // place that holds both the configured targets and the bus the screens
    // listen on. Still injected rather than read from YAML in the sense that
    // matters — `wakeScreen` is a function and comes from the composition
    // root; a `playbackAdapter:` key in school.yml could only ever have been
    // dead text.
    playback = playbackAdapter;
    if (!playback) {
      const configuredTargets = lifecycleCfg.media?.targets || [];
      if (!eventBus || typeof wakeScreen !== 'function' || !configuredTargets.length) {
        // Named, not silent: "the media action prints but nothing plays" is
        // otherwise a mystery with three possible causes.
        logger.info?.('school.lifecycle.no-playback-target', {
          hasEventBus: Boolean(eventBus),
          hasWakeScreen: typeof wakeScreen === 'function',
          targets: configuredTargets.length,
        });
      } else {
        const { ScreenPlaybackAdapter } = await import('#adapters/hardware/playback/ScreenPlaybackAdapter.mjs');
        playback = new ScreenPlaybackAdapter({
          eventBus,
          wakeScreen,
          // The whole `media.targets` list, not a screens-only subset: a target
          // missing its `location:` then refuses BY NAME ("add `location:` to
          // its media.targets entry") instead of reporting itself unknown.
          screens: configuredTargets,
          logger,
        });
        // Parked on `devices` for observability and for the wiring test. Safe:
        // `devices` only ever feeds `createSchoolVirtualDevicesRouter`, which
        // is built on the `useVirtual` branch alone — the mutually exclusive
        // one — so a real adapter here can never be driven from a browser.
        devices.playback = playback;
        logger.info?.('school.lifecycle.screen-playback', {
          targets: playback.targets().map((t) => t.id),
        });
      }
    }
  }

  // --- persistence -----------------------------------------------------------
  const baseCatalog = new YamlCurriculumDatastore({ configService });
  const stores = {
    catalog: new FitnessCourseCurriculumCatalog({
      baseCatalog, sourceProvider: fitnessPlayableService,
      projectionStore: new YamlFitnessCourseProjectionStore({ configService, logger }),
      householdId, logger,
    }),
    sessions: new YamlWorkSessionDatastore({ configService, logger }),
    tokens: tokenRegistry ?? new YamlTokenRegistry({ configService, logger }),
    assignments: new YamlAssignmentStore({ configService, logger }),
    formMaps: new YamlFormMapStore({ configService }),
    reviewQueue: new YamlReviewQueue({ configService, logger }),
    // Slice G (2026-08-22-omr-grading-integrity): per-learner "last agenda
    // printed" record, so a repeat card tap inside `agenda.cooldownMinutes`
    // does not put a second identical slip in the tray.
    agendaCooldown: new YamlAgendaCooldownStore({ configService, logger }),
    // Story-time evidence: durable `records/`, sharded by the household's own
    // study day so the launcher's "how many today" is one file read.
    readingLog: new YamlReadingLogStore({ configService, logger }),
    teacherActionReceipts: new YamlTeacherActionReceiptStore({ configService }),
  };
  // Long-expired token files are dead weight (a pruned scan resolves to the
  // "unknown ticket" slip, which is what week-old paper deserves). Swept at
  // boot and after mints; fire-and-forget so a slow disk never delays boot.
  stores.tokens.prune().catch((error) => {
    logger.warn?.('school.tokens.prune-failed', { error: error?.message });
  });

  // --- program launchers (Task 8/12/13) ---------------------------------------
  // The same IANA zone `SentenceLadderService` reads its 4am study-day boundary
  // against (`app.mjs`) — one source, so the agenda's "done today" and the
  // program's own idea of "today" can never drift apart.
  const timezone = configService.getTimezone?.() || null;
  // `donow` is INJECTED now (Task 13) — the real, household-level DoNowService
  // built once in `app.mjs`'s own `5_composition/modules/donow.mjs`, after the
  // seams every surface needs exist. This file used to stand up a minimal,
  // portal-only stopgap service (Task 12) so `SentenceLadderProgramLauncher` and the
  // bank hand-off had SOMETHING occupancy-aware to call before the real
  // registry existed — that stopgap is gone; a missing `donow` here now means
  // exactly what it means everywhere else in this file: every launch/program
  // path degrades to "Ask a grown-up to set this up." rather than throwing.
  //
  // Present only when the caller wired a language-study service: no service,
  // no launcher, and a program-typed unit degrades to "not answering" rather
  // than throwing (CurriculumAccess/ResolveSubjectNext's own try/catch).
  const launchers = new Map();
  if (languageStudyService) {
    const sentenceLadder = new SentenceLadderProgramLauncher({
      languageStudyService, donow, studyGrants, logger,
    });
    launchers.set('sentence-ladder', sentenceLadder);
    launchers.set('language', sentenceLadder); // persisted assignment compatibility
  }
  if (languageReelService && languageReelGrants) {
    launchers.set('language-reels', new LanguageReelsProgramLauncher({
      service: languageReelService, grants: languageReelGrants, donow,
    }));
  }
  if (flashcardStudyService) {
    launchers.set('flashcards', new FlashcardProgramLauncher({
      studyService: flashcardStudyService, assignments: stores.assignments, donow,
    }));
  }
  // RUBIKS_CUBE_COURSE_ID is null when course.yml hasn't been authored yet
  // (courseCatalog.mjs degrades rather than throwing at import) — the
  // service and grants are still constructed unconditionally upstream
  // (app.mjs), so this guard is the actual point where "no course" turns
  // into "no launcher" instead of a registered program that fails on use.
  if (rubiksCubeService && rubiksCubeGrants && RUBIKS_CUBE_COURSE_ID) {
    launchers.set('rubiks-cube', new RubiksCubeProgramLauncher({ service: rubiksCubeService, grants: rubiksCubeGrants, donow }));
  }
  // Parent day-bypass ledger. Constructed BEFORE the launcher because the
  // launcher consumes it: a bypass has to settle `status()` itself, which is
  // what makes the kiosk gate, the agenda card and the completion ceremony
  // agree about an excused day without any of them knowing the others exist.
  const { YamlProgramDayBypassStore } = await import('#adapters/persistence/yaml/YamlProgramDayBypassStore.mjs');
  const programDayBypassStore = new YamlProgramDayBypassStore({ configService });

  // Registered BEFORE the `school.yml` `programs:` loop below, so a config
  // entry that reuses this id trips that loop's collision check rather than
  // silently replacing an evidence-backed launcher with an honour-system one.
  let pianoCourseLauncher = null;
  if (pianoPlayableUnits) {
    pianoCourseLauncher = new PianoCourseProgramLauncher({
      getPlayableUnits: pianoPlayableUnits, donow, dayBypasses: programDayBypassStore,
      challengeCompletion: schoolPianoChallengeCompletionService, timezone, clock, logger,
    });
    launchers.set(pianoCourseLauncher.id, pianoCourseLauncher);
  } else {
    logger.warn?.('school.lifecycle.piano-course-unwired', { reason: 'no pianoPlayableUnits' });
  }

  // The piano kiosk's menu gate — "does this learner owe a lesson right now?".
  // Null without a launcher, which makes the lifecycle router skip the route
  // and the kiosk hook fail open to the ordinary menu.
  const { GetPianoLessonGate } = await import('#apps/school/usecases/GetPianoLessonGate.mjs');
  const getPianoLessonGate = pianoCourseLauncher
    ? new GetPianoLessonGate({ assignments: stores.assignments, launcher: pianoCourseLauncher, logger })
    : null;

  // Story time — a daily obligation with no course behind it. Unconditional:
  // its only dependencies are a YAML store and the assignments store, both of
  // which always exist, so unlike the service-backed launchers above there is
  // no degraded composition in which this should silently vanish. Registered
  // before the `school.yml` `programs:` loop for the same reason piano-course
  // is: a config entry reusing the id must trip that loop's collision check.
  launchers.set(STORY_TIME_PROGRAM_ID, new StoryTimeProgramLauncher({
    readingLog: stores.readingLog, assignments: stores.assignments, timezone, clock, logger, startReadingSession,
  }));

  // `school.yml` `programs:` — one `SurfaceProgramLauncher` per entry, config
  // selecting from the closed DoNow surface vocabulary (spec §6 "Surface
  // programs — how daily PE actually exists"). A program id colliding with a
  // CODE-registered launcher (`sentence-ladder`, including its `language`
  // compatibility alias) is a boot-time error REGARDLESS of
  // whether `donow` itself happens to be wired — a config mistake should
  // surface immediately, not only on deployments where DoNow is healthy. A
  // non-colliding entry that CANNOT be constructed (no `donow`/`donowDatastore`
  // — a degraded composition) is skipped with a loud warning instead: it
  // simply never resolves as a program, the same "unknown program" rejection
  // an unregistered id already gets everywhere else in this file.
  const configPrograms = Array.isArray(cfg.programs) ? cfg.programs : [];
  for (const entry of configPrograms) {
    const id = entry?.id;
    if (!id || !entry?.surface) {
      logger.warn?.('school.lifecycle.program-config-invalid', { entry });
      continue;
    }
    if (launchers.has(id)) {
      throw new Error(`school.yml programs: '${id}' collides with a code-registered launcher`);
    }
    if (!donow || !donowDatastore) {
      logger.warn?.('school.lifecycle.program-config-unwired', { id, reason: 'donow not wired' });
      continue;
    }
    launchers.set(id, new SurfaceProgramLauncher({
      id,
      label: entry.label ?? null,
      surface: entry.surface,
      action: entry.action ?? {},
      subject: entry.subject ?? null,
      // Author-supplied wording for "where does this send a child" (e.g.
      // `'in the garage'` for a `garage-fitness` program) — mirrors a
      // `launch:` unit's own `labelHint`. Unconfigured (`null`) degrades to a
      // generic phrase in BuildAgenda/ResolveScanAction rather than the
      // Portal default, which is only ever true for the Portal surface.
      locationHint: entry.locationHint ?? null,
      donow,
      datastore: donowDatastore,
      timezone,
      clock,
      logger,
    }));
  }

  // Surface id -> that surface's own `validateAction`, so a `launch:` unit
  // validates against the REAL registered adapter (Task 11's
  // `unitValidation.mjs` `launch:` composition) rather than a separately
  // built, possibly-drifted set. Function-wrapped and re-derived on every
  // call (matching `bankIds`/`programIds` above): `donowSurfaces` is read,
  // never captured, so a surface registered after this file's boot (there
  // isn't one today, but the shape is the same for-free consistency) would
  // still be seen. Absent `donowSurfaces` -> empty Map, matching
  // `CurriculumAccess`'s own default -> no unit can carry a `launch:` block.
  const surfaceValidators = new SchoolSurfaceValidatorCatalog({ surfaces: donowSurfaces });

  // --- collaborators ---------------------------------------------------------
  const draw = rng ?? cryptoRng(globalThis.crypto);
  // Shared by BuildAgenda and ResolveSubjectNext so a curriculum entry opened
  // by either one gets the same shape of session id.
  // LOWERCASE, and 10 chars rather than 8. `slugify` lowercases session ids to
  // build document ids, so a mixed-case mint spelled one session two ways
  // across the tree (`ses_hmSsHlJR` vs `ws-ses-hmsshljr`) and made that fold
  // lossy. A lowercase alphabet makes it the identity, and 10 chars keeps the
  // entropy above what the mixed-case 8 gave. Existing ids stay valid.
  const newSessionId = () => createSchoolSessionId();
  const bankReader = new SchoolServiceBankReader({ schoolService });
  const curriculum = new CurriculumAccess({
    catalog: stores.catalog,
    // Read per call, never captured: banks warm asynchronously after boot, and
    // a set snapshotted at construction would be empty for the first minute.
    bankIds: bankReader.listIds,
    // Same read-per-call rule: a launcher registered after boot (or one that
    // never showed up) must be reflected immediately, not frozen at construction.
    programIds: () => [...launchers.keys()],
    surfaceValidators: surfaceValidators.read,
    activityValidators: () => new Map([['fitness', validateFitnessActivityDescriptor]]),
    logger,
  });
  const receipts = new ReceiptPrinting({ renderer: receiptPrintRenderer, printer: receiptPrinter, logger });
  // Who may act for a child. Read through `userService` per call, never
  // snapshotted: a member added after boot is a member. With no user service at
  // all, nobody is a grown-up and every parent-only write is refused — the
  // console still teaches and prints, it just cannot be signed off, which is the
  // right way round for a household with an unreadable roster.
  const schoolRoster = new HouseholdSchoolRoster({ userService });
  const grownUps = new GrownUpGate({
    roster: schoolRoster.list,
    clock,
    logger,
  });

  // The console write predicate (teacher-console spec §1): role + pin over
  // the same live-roster adult rule, via the one shared factory so the
  // config accessors cannot drift between composition sites.
  const teacherConfig = new SchoolTeacherConfigSource({ configService });
  const teacherGate = makeTeacherGate({
    loadTeachers: teacherConfig.teachers,
    loadTeacherPin: teacherConfig.pin,
    userService, clock, logger,
  });
  const { YamlCurriculumExceptionStore } = await import('#adapters/persistence/yaml/YamlCurriculumExceptionStore.mjs');
  const { ManageCurriculumException } = await import('#apps/school/usecases/ManageCurriculumException.mjs');
  const curriculumExceptionStore = new YamlCurriculumExceptionStore({ configService });
  const manageCurriculumException = new ManageCurriculumException({ store: curriculumExceptionStore, curriculum, teacherGate, clock });
  // The Teacher Console's write side of the day-bypass ledger the piano
  // launcher already reads (constructed above). `eventBus` is optional here
  // for the same reason it is everywhere else in this file: no bus means no
  // live push to the kiosk, and the kiosk's own poll still catches up.
  const { ManageProgramDayBypass } = await import('#apps/school/usecases/ManageProgramDayBypass.mjs');
  const manageProgramDayBypass = new ManageProgramDayBypass({
    store: programDayBypassStore, assignments: stores.assignments, teacherGate,
    realtime: schoolRealtime, timezone, clock, logger,
  });
  // Mid-period pass-criteria overrides (W3-2): read at grade time, one
  // consumption point (CloseSessionOutcome).
  const passOverrides = new YamlPassOverrideStore({ configService, logger });
  // Repair-wave sources (spec D2/D3): same files app.mjs's route instances
  // read — stateless per-call reads, so two instances cannot drift.
  const attestations = new YamlAttestationLog({ configService, logger });
  const teacherNotes = new YamlTeacherNotes({ configService, logger });

  // ONE assembler for "what's next", shared by every surface that answers the
  // question. Before this, six call sites hand-built the planner's inputs with
  // six slightly different recipes, and the printed agenda, the scanned ticket
  // and the panel code could genuinely disagree about what a child was allowed
  // to do next. They now cannot: there is one recipe, and a surface that wants
  // a narrower one (`getLearnerDayCompletion`) says so in flags a reader can
  // see rather than by omitting lines nobody notices.
  //
  // Two instances stay separate, both deliberately:
  //   - `previewPlanProjection` below reads through the dry-run session store
  //     and logs under the preview's child logger.
  //   - `closeSessionOutcome` keeps its own (built inside the use case): it is
  //     wired with no launchers and defaults `timezone` to UTC rather than
  //     null, and a receipt is not the place to discover that those differ.
  const planProjection = new PlanProjection({
    curriculum, assignments: stores.assignments, sessions: stores.sessions,
    attestations, curriculumExceptions: curriculumExceptionStore,
    launchers, timezone, clock, logger,
    declaredEntryActions,
  });

  // --- use cases -------------------------------------------------------------
  const buildAgenda = new BuildAgenda({
    planProjection,
    attestations, teacherNotes,
    curriculum, assignments: stores.assignments, sessions: stores.sessions, tokens: stores.tokens,
    launchers, languageReelService, timezone, clock, rng: draw, newSessionId,
    // Optional knob; BuildAgenda's own default (168h) applies when unset.
    subjectTokenTtlHours: lifecycleCfg.subjectTokenTtlHours,
    // Read-only: the "Notes for you" section (spec R7) reads a learner's
    // resolved review items, never writes one.
    reviewQueue: stores.reviewQueue, logger,
    schoolCalcStudies,
    schoolCalcMode: schoolCalcStudies ? 'issue' : 'off',
    curriculumExceptions: curriculumExceptionStore,
    // `school.yml`'s own `selfService` block, passed through untouched. Off (or
    // absent) means BuildAgenda mints no panel codes and the receipt is exactly
    // what it printed before the feature existed.
    selfService: cfg.selfService,
  });
  const resolveSubjectNext = new ResolveSubjectNext({
    planProjection,
    attestations,
    curriculum, assignments: stores.assignments, sessions: stores.sessions,
    launchers, timezone, clock, newSessionId, curriculumExceptions: curriculumExceptionStore, logger,
  });
  // Read-only twin of `buildAgenda`'s planning path (design
  // 2026-08-23-student-completion-state-machine): "is this learner done for
  // today?", derived on demand, no session or token side effects.
  const getLearnerDayCompletion = new GetLearnerDayCompletion({
    // The SAME projection the agenda plans from — asked for a NARROWER view
    // (no attested passes, no exceptions). Assigned programs ARE included as
    // of 2026-08-28: excluding them made the day of a programs-only learner
    // project to zero sections, which reads `no_work_today` and unlocks games.
    // That is a completion-semantics decision and it lives in the use case,
    // stated, not in this wiring — but `launchers` below is what makes it
    // possible, so it must keep being passed.
    planProjection,
    curriculum, assignments: stores.assignments, sessions: stores.sessions,
    launchers, timezone, clock, logger,
  });

  // --- dry-run agenda preview (DoNow + Agenda Preview plan, Task 2) ---------
  // A parent-facing "what would print right now" view. It runs the exact same
  // algorithm as `buildAgenda` above — same curriculum, same planner, same
  // program launchers — but against dry-run stand-ins for sessions and tokens,
  // so a preview can never open a real work session or mint/display a
  // scannable ticket. `appendEvent` is a no-op because `ensureSession` only needs to
  // REDUCE a session's events to decide what is next; it never has to persist
  // one for a preview to be accurate.
  const previewSessions = new PreviewSchoolSessionStore({ sessions: stores.sessions });
  const previewPlanProjection = new PlanProjection({
    curriculum, assignments: stores.assignments, sessions: previewSessions,
    attestations, curriculumExceptions: curriculumExceptionStore,
    launchers, timezone, clock,
    planErrorEvent: 'school.agenda.plan-errors',
    launcherFailedEvent: 'school.agenda.launcher-failed',
    logger: logger.child ? logger.child({ preview: true }) : logger,
  });
  const previewAgenda = new BuildAgenda({
    planProjection: previewPlanProjection,
    attestations, teacherNotes,
    curriculum, assignments: stores.assignments, sessions: previewSessions,
    // Write path stubbed, READ path real: a preview must never persist a
    // ticket, but it must see the codes that are already live, or it would
    // show a parent a code that belongs to a different child's lesson.
    tokens: new PreviewSchoolTokenRegistry({ tokens: stores.tokens }),
    launchers, languageReelService, timezone, clock, rng: draw, newSessionId,
    subjectTokenTtlHours: lifecycleCfg.subjectTokenTtlHours,
    // Same real, read-only review queue as `buildAgenda` — a preview showing
    // no notes when the real print would have some is a preview that lies.
    reviewQueue: stores.reviewQueue,
    schoolCalcStudies,
    schoolCalcMode: schoolCalcStudies ? 'preview' : 'off',
    selfService: cfg.selfService,
    // Teacher planning is a non-recording view.  Its document must not carry
    // a token or panel code that resembles an issued agenda ticket.
    previewOnly: true,
    curriculumExceptions: curriculumExceptionStore,
    logger: logger.child ? logger.child({ preview: true }) : logger,
  });
  const teacherAgendaDispatch = new TeacherAgendaDispatch({
    previewAgenda, buildAgenda, receipts, teacherGate, receiptStore: stores.teacherActionReceipts, clock, logger,
  });
  // `receiptPngRenderer` (the canvas renderer) is already built above,
  // before `receipts` — it backs BOTH the printed receipt (via
  // `receiptPrintRenderer`) and this preview route, so a parent previewing an
  // agenda and a child holding the printed one are always looking at the
  // output of the same renderer instance.
  // --- print documents (Task 7, spec §9): tracked quizzes through IssueDocument ---
  // Rooted at the SAME content root `school.mjs docs` defaults to
  // (`<dataDir>/household/school/artifacts/print`) — a unit
  // authored/published via the CLI is exactly what a child's scan resolves
  // against here. These are machine-written artifacts, so they live with the
  // rest of School's household state rather than on the authored content
  // mount, which holds only abstract coursework. Cheap
  // to construct (no I/O at construction time — both stores read/write
  // lazily), and only ever exercised when a unit's `document` actually names
  // a `print/<id>@<rev>` reference (`IssueDocument`'s own prefix branch), so
  // wiring them unconditionally costs a legacy-only deployment nothing.
  const printDocumentsRoot = configService.getHouseholdPath('school/artifacts/print');
  // Hand-authored SOURCES are a different kind of thing from the artifacts
  // above — a document CLASS, not a published object. The artifacts are machine
  // written and live with School's household state; the sources are authored and
  // stay on the content mount, on the learning-catalog shelf beside the
  // `school.learning-document/v1` files — the same mount `createSchoolCatalog`
  // resolves as `documentDirectories` (`catalog.content.document_directories`,
  // default `<contentRoot>/documents`). Resolved here directly because
  // `resolveDirectoryList`/`resolveFromData` are module-private to
  // `schoolCatalog.mjs` and this module has no handle on the catalog wiring;
  // if that mount ever becomes configurable for print sources too, both should
  // move behind one shared helper rather than growing a second convention.
  const printSourceRoot = path.join(dataDir, 'content/school/learning-catalog/documents');
  const printDocuments = new YamlPrintDocumentRepository({
    directory: printDocumentsRoot,
    sourceDirectory: printSourceRoot,
  });
  const allocationStore = new YamlAllocationStore({ directory: printDocumentsRoot, timeZone: timezone, logger });
  const heldCardScans = new YamlHeldCardScanStore({ directory: printDocumentsRoot });
  const resolveCardScan = new ResolveCardScan({
    allocationStore,
    repository: printDocuments,
    banks: createYamlBankReader({ dataDir }),
    heldScanStore: heldCardScans,
    protectionMode: cfg.answer_sheets?.scan_protection?.mode ?? 'off',
    logger,
  });
  const reviewHeldCardScan = new ReviewHeldCardScan({
    heldScanStore: heldCardScans,
    allocationStore,
    repository: printDocuments,
    resolveCardScan,
    teacherGate,
    clock,
    logger,
  });
  const worksheetInstances = new YamlWorksheetInstanceStore({ configService, logger });
  const companions = new YamlLessonCompanionStore({ configService, logger });
  // One finish code per (household, lesson, lessonDay), shared across the
  // household's children — constructed HERE and injected, never imported by the
  // use case (D1: an application may not reach for an adapter).
  const companionCodes = new YamlCompanionCodeStore({ configService, logger });
  // The SAME code-store instance `IssueDocument` mints against, deliberately:
  // the record the print binds is the record the read-along satisfies, and a
  // second instance over the same directory would only be a second way to
  // describe one file.
  const companionHandlers = new LessonCompanionHandlers([
    new ReadalongLessonCompanionHandler({ companions, companionCodes, clock, logger }),
  ]);
  const issuedArtifacts = new YamlIssuedArtifactStore({ configService });
  // Capture the same canvas the thermal raster path draws. The application
  // receives a small port returning immutable PNG bytes, never a renderer.
  const receiptArtifactRenderer = receiptPngRenderer
    ? new ReceiptPngArtifactRenderer({ renderer: receiptPngRenderer })
    : null;
  const receiptCapture = receiptArtifactRenderer ? new CaptureResultReceiptArtifact({
    issuedArtifacts,
    renderReceipt: receiptArtifactRenderer.render,
    logger,
  }) : null;
  const receiptArtifactPrinter = receiptPrinter
    ? new RetainedReceiptPrinter({ printer: receiptPrinter, textRenderer: receiptRenderer, logger })
    : null;
  const renderPrintDocument = new RenderPrintDocument({
    rendering: printDocumentRendering,
    repository: printDocuments,
    banks: createYamlBankReader({ dataDir }),
    allocationStore,
  });

  const issueDocument = new IssueDocument({
    curriculum, sessions: stores.sessions, tokens: stores.tokens,
    renderer: documentRenderer, printer: laserPrinter, formMaps: stores.formMaps,
    printDocuments, renderPrintDocument, allocationStore,
    assignments: stores.assignments, worksheetInstances, companions,
    // `householdId` is the first third of a finish code's scope — the reason
    // two houses on the same published lesson never share a code.
    companionCodes, householdId,
    issuedArtifacts,
    answerSheetPolicy: cfg.answer_sheets ?? null,
    // Same `printing:` block the laser host/port/path and the page-quota
    // policy keys already live in (see the printer construction above and
    // `PrintService`'s `#policy` getter) — one block, one place a grown-up
    // edits the household's whole print posture from.
    printCooldownMinutes: cfg.printing?.printCooldownMinutes ?? null,
    bankReader, clock, rng: draw, timezone, logger,
    curriculumExceptions: curriculumExceptionStore,
  });
  const issueComposedWorksheet = new IssueComposedWorksheet({
    curriculum, sessions: stores.sessions, assignments: stores.assignments,
    worksheetInstances, bankReader, printDocuments, renderPrintDocument,
    allocationStore, printer: laserPrinter, issuedArtifacts, answerSheetPolicy: cfg.answer_sheets ?? null,
    teacherGate, clock, logger,
  });
  const { ReprintIssuedArtifact } = await import('#apps/school/usecases/ReprintIssuedArtifact.mjs');
  const reprintIssuedArtifact = new ReprintIssuedArtifact({
    issuedArtifacts, sessions: stores.sessions, printer: laserPrinter, teacherGate,
    curriculumExceptions: curriculumExceptionStore, clock, logger,
  });
  const reprintResultReceiptArtifact = receiptArtifactPrinter ? new ReprintResultReceiptArtifact({
    issuedArtifacts, sessions: stores.sessions, teacherGate, receiptArtifactPrinter, clock,
  }) : null;
  const issueCorrectedResultReceipt = receiptCapture ? new IssueCorrectedResultReceipt({
    sessions: stores.sessions, curriculum, worksheetInstances, receiptCapture, clock, timezone,
  }) : null;
  const dispatchMedia = playback
    ? new DispatchMedia({
      curriculum, sessions: stores.sessions, playback,
      targets: lifecycleCfg.media?.targets || [], clock, logger,
    })
    : null;
  const recordMediaCompletion = new RecordMediaCompletion({
    curriculum, sessions: stores.sessions, clock,
    graceSec: lifecycleCfg.media?.graceSec ?? 600, logger,
  });
  // `worksheetInstances` reaches BOTH paper use cases read-only, for one
  // reason: a unit with a `bank` and no `document` prints a SAMPLED subset of
  // that bank, and the instance is the only record of which questions the child
  // was actually asked. Without it here, both used the live bank as the roster —
  // grading a ten-question sheet out of the whole bank and demanding a grown-up
  // mark the questions the sampler never printed.
  const submitPaperWork = new SubmitPaperWork({
    curriculum, sessions: stores.sessions, formMaps: stores.formMaps,
    reviewQueue: stores.reviewQueue, bankReader, worksheetInstances, clock, logger,
  });
  const gradeSubmission = new GradeSubmission({
    curriculum, sessions: stores.sessions, reviewQueue: stores.reviewQueue,
    grader: schoolService, bankReader, worksheetInstances,
    grownUps, teacherGate, passOverrides, clock, logger,
  });
  const closeSessionOutcome = new CloseSessionOutcome({
    curriculum, sessions: stores.sessions, tokens: stores.tokens, assignments: stores.assignments,
    passOverrides,
    worksheetInstances,
    timezone,
    // The result receipt is where a FAILED attempt's retry barcode reaches the
    // child's hand. Without this the close-out returned JSON and the loop
    // dead-ended.
    receipts,
    receiptCapture,
    receiptArtifactPrinter,
    economy: economyService,
    economyAction: lifecycleCfg.economy?.action || 'school-unit-complete',
    economyEnabled: lifecycleCfg.economy?.enabled === true,
    grownUps,
    teacherGate,
    // Read-only: this session's own resolved-item notes on the result receipt
    // (spec R7) — the same store `gradeSubmission`/`resolveReviewItem` write.
    reviewQueue: stores.reviewQueue,
    // The SAME `school.yml` block `buildAgenda` mints codes from (Slice H,
    // 2026-08-22): without this, the "next up" QR on a result receipt never
    // got a panel code even on a household with self-service on — the QR
    // `resultDocument` had no code parameter for at all until this slice.
    selfService: cfg.selfService,
    // Receipts must use precisely the completion view that governs Piano
    // Games: programs count, attestations and exceptions do not.
    planProjection,
    // Every settle publishes `school.session.outcome-recorded` (design
    // 2026-08-23-student-completion-state-machine) for `schoolCompletionBridge`
    // below — optional, so an install with no eventBus settles exactly as
    // it did before that feature existed.
    realtime: schoolRealtime,
    clock, rng: draw, logger,
  });
  const closeLanguageDay = languageStudyService && schoolRealtime
    ? new CloseLanguageDay({
      assignments: stores.assignments, curriculum, sessions: stores.sessions,
      closeSessionOutcome, realtime: schoolRealtime, clock, logger,
    })
    : null;
  const openRemediation = new OpenRemediation({ curriculum, sessions: stores.sessions,
    curriculumExceptions: curriculumExceptionStore, clock, logger });
  const replaceRemediation = new ReplaceRemediation({
    curriculum, sessions: stores.sessions, teacherGate, clock, newSessionId, logger,
  });
  // One name lookup for everything that prints a learner's name — the card
  // scan AND the agenda routes, so tape and preview show the same header.
  const resolvePersonalCard = new ResolvePersonalCard({
    buildAgenda, receipts,
    // The SAME capture port the result-receipt path uses — one canvas renderer,
    // one artifact store, two `kind`s. The agenda leg was simply never wired,
    // so every printed agenda was rendered and thrown away while result
    // receipts had been archived all along.
    captureAgenda: receiptCapture,
    roster: schoolRoster,
    // Slice G: the SAME `school.yml` top level `agenda:` block a household
    // edits alongside `printing:`/`selfService:` — `cooldownMinutes: 0`
    // disables the cooldown outright; unset falls through to
    // ResolvePersonalCard's own 15-minute default.
    cooldown: stores.agendaCooldown,
    cooldownMinutes: cfg.agenda?.cooldownMinutes,
    // L-5: a suppressed tap still built an agenda, which mints a live access
    // code — this hands it back to the registry instead of leaving it live
    // for a receipt nobody holds.
    tokens: stores.tokens,
    clock,
    logger,
  });
  // The media leg is optional (a household with no playback target still prints
  // worksheets), but the scan resolver is not — so a no-op stand-in keeps the
  // single entry point whole rather than making every caller check.
  const mediaOrNothing = dispatchMedia ?? new UnavailableSchoolMediaDispatcher();
  const replaceLostAnswerSheet = new ReplaceLostAnswerSheet({
    allocationStore, printDocuments, renderPrintDocument, printer: laserPrinter,
    teacherGate, clock, logger,
  });
  const createLostAnswerSheetTicket = new CreateLostAnswerSheetTicket({
    tokens: stores.tokens, teacherGate, clock, rng: draw, logger,
    ttlMinutes: cfg.answer_sheets?.lost_ticket_ttl_minutes ?? 15,
  });
  const resolveScanAction = new ResolveScanAction({
    tokens: stores.tokens, sessions: stores.sessions, curriculum,
    resolvePersonalCard, issueDocument, dispatchMedia: mediaOrNothing, openRemediation,
    receipts, resolveSubjectNext, launchers,
    // No `portal` here anymore — `PortalDispatch` (Task 12's un-occupancy-
    // checked stopgap) is deleted; `#onScreen`'s legacy fallback branch is
    // still defensively present in `ResolveScanAction` (never actually reached
    // from this composition now that `donow` is unconditionally wired), but
    // this file constructs nothing to feed it.
    donow, closeSessionOutcome, clock, logger,
    externalActivityProvider: fitnessSchoolCourseService,
    resolveLearningAction: schoolCalcActionResolver,
    replaceLostAnswerSheet,
  });

  // The pending->approved half of the launch-unit loop (spec §6 "the approval
  // gap"): `ResolveScanAction#dispatchLaunch` handles the SYNCHRONOUS
  // dispatched case inline; a request that PENDS is approved later, out of
  // band, by a grown-up working the DoNow approvals queue — nobody is
  // scanning a card at that moment for `ResolveScanAction` to answer. This
  // bridge subscribes to the shared `donow` eventBus topic and closes the
  // loop when that happens. Only constructible with a real `eventBus`
  // (`DoNowSchoolBridge`'s own constructor guard) — absent, a pending launch
  // unit simply never gets its honor-close on approval (still visible/
  // resolvable via a fresh scan), rather than this file throwing.
  let donowSchoolBridge = null;
  let fitnessSchoolAssessmentBridge = null;
  if (realtimeSubscriptionsAvailable && schoolRealtime?.onApprovedLaunchDispatched) {
    donowSchoolBridge = new DoNowSchoolBridge({
      realtime: schoolRealtime, sessions: stores.sessions, closeSessionOutcome, clock, logger,
    });
    donowSchoolBridge.start();
    if (fitnessSchoolCourseService) {
      fitnessSchoolAssessmentBridge = new FitnessSchoolAssessmentBridge({
        realtime: schoolRealtime, sessions: stores.sessions, curriculum, closeSessionOutcome,
        evidenceRepository: learningEvidenceRepository, clock, logger,
      });
      fitnessSchoolAssessmentBridge.start();
    }
  } else {
    logger.warn?.('school.lifecycle.donow-bridge-unwired', { reason: 'no eventBus' });
  }

  // Pushes `school.completion.state-observed` on an actual learner-day
  // completion transition (design 2026-08-23-student-completion-state-machine)
  // after any authoritative completion input changes.
  // Absent an eventBus, completion is still readable directly via
  // `getLearnerDayCompletion`; only the push notification is unavailable.
  let schoolCompletionBridge = null;
  let pianoLessonCeremonyBridge = null;
  if (realtimeSubscriptionsAvailable && (schoolRealtime?.onCompletionInputChanged || schoolRealtime?.onSessionOutcomeRecorded)) {
    schoolCompletionBridge = new SchoolCompletionBridge({
      realtime: schoolRealtime, getLearnerDayCompletion, clock, logger,
    });
    schoolCompletionBridge.start();
    // The daily piano requirement's own announcement — distinct from the
    // day-completion bridge above, which fires when the WHOLE day settles.
    // Constructible only with both a launcher and a bus; the HA limb is
    // optional (a household with no Home Assistant still gets the Portal
    // banner).
    if (pianoCourseLauncher) {
      pianoLessonCeremonyBridge = new PianoLessonCeremonyBridge({
        realtime: schoolRealtime,
        assignments: stores.assignments,
        launcher: pianoCourseLauncher,
        evidenceRepository: learningEvidenceRepository,
        hook: pianoLessonHook,
        resolveStudent: (learnerId) => configService.getUserProfile?.(learnerId)?.name ?? learnerId,
        timezone, clock, logger,
      });
      pianoLessonCeremonyBridge.start();
    }
  } else {
    logger.warn?.('school.lifecycle.completion-bridge-unwired', { reason: 'no eventBus' });
  }

  // The two parent-only writes. They are use cases rather than raw store calls
  // because the router may not be the place a child's sign-off is checked.
  const resolveReviewItem = new ResolveReviewItem({
    reviewQueue: stores.reviewQueue, grownUps, teacherGate, clock, logger,
    // The review loop CLOSES ITSELF (student-advocacy A1): when the last
    // pending item of a session gets its verdict, the same act grades and
    // settles the session — receipt, coins, unlock — instead of holding a
    // child's finished work hostage to an out-of-band actor.
    gradeSubmission, closeSessionOutcome,
  });
  // Stale-sweep roster (admin advocacy A5): the same students: list the rest
  // of the lifecycle serves — enough identity for listStale, no directory dep.
  const markSessionAbandoned = new MarkSessionAbandoned({
    sessions: stores.sessions, teacherGate, learnerDirectory, clock, logger,
  });
  const worksheetRecoveryAuthority = Object.freeze({ kind: 'worksheet-attribution-recovery' });
  const invalidateSessionEvidence = attemptDatastore ? new InvalidateSessionEvidence({
    sessions: stores.sessions,
    datastore: attemptDatastore,
    teacherGate,
    trustedAuthority: worksheetRecoveryAuthority,
    clock,
    logger,
  }) : null;
  const recoverMisattributedWorksheet = invalidateSessionEvidence
    ? new RecoverMisattributedWorksheet({
      sessions: stores.sessions,
      allocationStore,
      teacherGate,
      invalidateSessionEvidence,
      submitPaperWork,
      gradeSubmission,
      closeSessionOutcome,
      markSessionAbandoned,
      issueDocument,
      invalidationAuthority: worksheetRecoveryAuthority,
      clock,
      newSessionId,
      logger,
    })
    : null;
  const setAssignments = new SetAssignments({
    assignments: stores.assignments, grownUps, teacherGate, curriculum,
    programValidators: createSchoolProgramEnrollmentValidators({
      languageStudyService,
      languageReelService,
      flashcardStudyService,
      pianoCourseLauncher,
      rubiksCubeService,
      rubiksCubeCourseId: RUBIKS_CUBE_COURSE_ID,
    }),
    roster: () => userService?.getHouseholdRoster?.() ?? [],
    realtime: schoolRealtime, clock, logger,
  });

  // --- syllabi + enrollment (spec: docs/reference/school/enrollment.md) ------
  const syllabusStore = new YamlSyllabusStore({ configService, logger });
  const timingAnchorStore = new YamlTimingAnchorStore({ configService, logger });
  // The store is dumb; validation and the teacher gate belong to the write,
  // not to persistence — the same split SetAssignments/YamlAssignmentStore use.
  const syllabi = new SyllabusManagementService({
    store: syllabusStore,
    teacherGate,
    curriculum,
    clock,
  });

  const enrollLearner = new EnrollLearner({
    syllabi: syllabusStore, assignments: stores.assignments, curriculum,
    sessions: stores.sessions, timingAnchors: timingAnchorStore, teacherGate, realtime: schoolRealtime, clock, timezone, logger,
  });
  const unenrollLearner = new UnenrollLearner({
    assignments: stores.assignments, curriculum, sessions: stores.sessions,
    teacherGate, realtime: schoolRealtime, clock, logger,
  });

  // --- the school-room panel's keypad (self-service access codes, §4) -------
  // The READ half only: six digits in, a launch card out. It shares every
  // collaborator with `resolveSubjectNext` above — same curriculum instance,
  // same session repository, same launcher map — but computes the plan without
  // ensuring a session, so a child typing a sibling's code cannot open work in
  // that sibling's history. `issueDocument` is handed over for exactly one
  // synchronous question (`canIssueBank`), which is the print-or-screen call
  // the pure card builder is deliberately not allowed to make for itself.
  //
  // `cfg.selfService` is the SAME `school.yml` block `buildAgenda` mints codes
  // from, passed through untouched — one config path, so the room a video goes
  // to and the codes that reach it can never come from two different readings.
  const resolveAccessCode = new ResolveAccessCode({
    planProjection,
    tokens: stores.tokens,
    curriculum,
    assignments: stores.assignments,
    sessions: stores.sessions,
    launchers,
    attestations,
    curriculumExceptions: curriculumExceptionStore,
    issueDocument,
    companions,
    roster: schoolRoster,
    selfService: cfg.selfService,
    timezone,
    clock,
    logger,
  });

  // The WRITE half. `/act` is where a button press earns a real session — the
  // `ensureSession` that `resolveAccessCode` above deliberately does not do —
  // so it takes the SAME session repository and the SAME `newSessionId` the
  // agenda builder opens sessions with, and the same use-case instances the
  // scan path acts through (`issueDocument`, `mediaOrNothing`,
  // `openRemediation`, `donow`, `closeSessionOutcome`). Deliberately NOT
  // routed through `ResolveScanAction` (design D7): every exit from that file
  // prints a thermal slip, and a keypad tap must not put paper in the tray.
  const runSelfServiceAction = new RunSelfServiceAction({
    resolveAccessCode,
    sessions: stores.sessions,
    issueDocument,
    dispatchMedia: mediaOrNothing,
    openRemediation,
    donow,
    closeSessionOutcome,
    // The SAME launcher map `resolveScanAction` and `resolveAccessCode` get.
    // Without it the panel cannot tell a Portal program (which really does
    // open on this screen) from a `garage-fitness` one, and would tell every
    // child their work was opening in front of them.
    launchers,
    companions, companionHandlers,
    newSessionId,
    clock,
    logger,
  });
  const recordLessonCompanionProgress = new RecordLessonCompanionProgress({ companions, handlers: companionHandlers });
  // The escape hatch for a companion whose media is broken: a grown-up reads
  // the finish code out. Built HERE because the code store and `householdId`
  // are here — the same two things `issueDocument` mints against, deliberately
  // the SAME INSTANCE, so the record a reveal reads is the record a print
  // created and a read-along satisfies. The use case never imports the adapter
  // (D1); it is handed one.
  const getCompanionFinishCode = new GetCompanionFinishCode({
    sessions: stores.sessions, curriculum, companionCodes, teacherGate, householdId, clock, logger,
  });
  // The SAME `laserPrinter` every tracked worksheet and receipt prints
  // through, so "is the printer OK?" is asked of the device the child's paper
  // was actually sent to — not a second, separately-configured one that could
  // be healthy while the real one sits jammed.
  const readPrinterHealth = new ReadPrinterHealth({ printer: laserPrinter, logger });

  const listLearnerSessions = new ListLearnerSessions({ sessions: stores.sessions, timezone, clock });
  const listPrintableWorksheetSessions = new ListPrintableWorksheetSessions({ listLearnerSessions, curriculum });

  const useCases = {
    buildAgenda, issueDocument, issueComposedWorksheet, dispatchMedia, recordMediaCompletion,
    submitPaperWork, gradeSubmission, closeSessionOutcome, openRemediation, replaceRemediation,
    resolvePersonalCard, resolveScanAction, resolveReviewItem, resolveCardScan, reviewHeldCardScan,
    setAssignments, closeLanguageDay,
    previewAgenda, markSessionAbandoned, replaceLostAnswerSheet, createLostAnswerSheetTicket,
    invalidateSessionEvidence, recoverMisattributedWorksheet,
    enrollLearner, unenrollLearner, resolveAccessCode, runSelfServiceAction, recordLessonCompanionProgress,
    getLearnerDayCompletion, teacherAgendaDispatch, reprintIssuedArtifact, reprintResultReceiptArtifact, issueCorrectedResultReceipt, manageCurriculumException,
    getPianoLessonGate, manageProgramDayBypass, getCompanionFinishCode,
  };

  const lifecycleAgendaResource = new SchoolLifecycleAgendaResource({
    buildAgenda, previewAgenda, pngRenderer: receiptPngRenderer, roster: schoolRoster,
  });
  const lifecycleReadService = new SchoolLifecycleReadService({
    sessions: stores.sessions,
    listLearnerSessions,
    listPrintableWorksheetSessions,
    reviewQueue: stores.reviewQueue,
    curriculum,
    assignments: stores.assignments,
  });
  const lifecycleSyllabusService = new SchoolLifecycleSyllabusService({ syllabi });
  const router = createSchoolLifecycleRouter({
    ...useCases,
    lifecycleAgendaResource,
    lifecycleReadService,
    lifecycleSyllabusService,
    logger,
  });

  // Mounted at `/api/v1/school/self-service` by app.mjs, inside this same
  // `lifecycle.enabled` gate — a panel configured `mode: locked` against a
  // disabled lifecycle would otherwise show a keypad whose /resolve 404s, and
  // per-screen lock config ships independently of `school.yml`.
  //
  // `selfService.enabled` GATES THE ROUTER, not just minting. `BuildAgenda`
  // reads the same flag to decide whether to print a code beside a lesson, but
  // codes already on paper stay live until `accessCodeExpiresAt` — up to a
  // whole study day. Without this gate, an operator who switches the feature
  // off because something is wrong keeps serving the thing they just switched
  // off, for every sheet already in a child's hands. A 404 here is a contract
  // the panel already handles: it shows the degraded sentence and a retry, so
  // the child gets words and a way forward rather than a dead keypad.
  //
  // Household app config is cached in memory at startup, so flipping this in
  // `school.yml` needs a restart to take effect.
  const selfServiceEnabled = cfg.selfService?.enabled === true;
  const selfServiceRouter = selfServiceEnabled
    ? createSchoolSelfServiceRouter({
      resolveAccessCode,
      runSelfServiceAction,
      recordLessonCompanionProgress,
      readPrinterHealth,
      curriculum,
    })
    : null;
  if (!selfServiceEnabled) {
    logger.info?.('school.lifecycle.self-service-off', { reason: 'selfService.enabled is not true' });
  }

  // Only when the doubles exist; the factory itself also refuses to register a
  // route for a device it was not handed.
  const devicesRouter = useVirtual
    ? createSchoolVirtualDevicesRouter({
      consoleOperations: new VirtualSchoolDeviceConsole({
        ...devices,
        getFormMap: (formId) => stores.formMaps.get(formId),
      }),
      logger,
    })
    : null;

  logger.info?.('school.lifecycle.ready', {
    virtualDevices: useVirtual,
    media: Boolean(dispatchMedia),
    receipts: receipts.wired,
    economy: lifecycleCfg.economy?.enabled === true,
    launchers: [...launchers.keys()],
  });

  return {
    wired: true,
    reason: null,
    handlesCode: (code) => isSchoolToken(code),
    handleScan: ({ code, device = null }) => resolveScanAction.execute({ code, device }),
    reporter: new WorkSessionReporter({
      curriculum, sessions: stores.sessions, assignments: stores.assignments,
      reviewQueue: stores.reviewQueue, clock, logger,
    }),
    router,
    devicesRouter,
    selfServiceRouter,
    useCases,
    // `curriculum` is the read model every use case above shares — the same
    // cache, so a caller reading a unit sees exactly what the console saw.
    // `printDocuments`/`allocationStore` are the SAME instances `issueDocument`
    // writes through (Task 7, spec §9) — exposed so app.mjs's scan-consumption
    // wiring (`ResolveCardScan`) reads/writes the identical allocation records
    // rather than a second store pointed at a directory that could drift.
    stores: {
      ...stores, curriculum, printDocuments, allocationStore, heldCardScans, worksheetInstances, companions, issuedArtifacts, curriculumExceptionStore,
      programDayBypassStore,
    },
    // The `RenderPrintDocument` instance the print-document pipeline shares
    // between `issueDocument`'s tracked-quiz path and any other caller (proof
    // renders from a future admin surface) — exposed for the same reuse
    // reason as `stores.printDocuments`/`stores.allocationStore` above.
    renderPrintDocument,
    // The program launchers, exposed so a caller can ask each one how it is
    // ENTERED (`entryAction`) without re-deriving the registry. app.mjs uses
    // this for the startup reachability report — the fast signal that pairs
    // with the per-projection fault.
    launchers,
    devices,
    // The renderers this console built, exposed for inspection. `receipt` is
    // the ESC/POS text renderer (fallback + transcript source now, not the
    // print path); `receiptPng` is the raw canvas renderer the preview route
    // draws with; `receiptPrint` is what `receipts` actually prints through —
    // the raster-with-fallback wrapper when built, `receipt` alone otherwise.
    // None of the three is reachable any other way, and a caller that wants
    // to know whether a document can be drawn on 58mm tape should ask the one
    // that will draw it.
    renderers: {
      document: documentRenderer, receipt: receiptRenderer,
      receiptPng: receiptPngRenderer, receiptPrint: receiptPrintRenderer,
    },
    renderReceiptArtifact: receiptArtifactRenderer?.render ?? null,
    // Null when no eventBus was wired (see above) — `app.mjs` calls
    // `schoolLifecycle.donowSchoolBridge?.stop()` on shutdown, same
    // conditional-on-existence pattern as its other graceful-shutdown hooks.
    donowSchoolBridge,
    fitnessSchoolAssessmentBridge,
    closeLanguageDay,
    // Read-only completion status ("is this learner done for today?") and
    // its push-on-transition bridge — same null-when-unwired,
    // optional-chained-on-shutdown convention as `donowSchoolBridge` above.
    getLearnerDayCompletion,
    realtime: schoolRealtime,
    schoolCompletionBridge,
    pianoLessonCeremonyBridge,
    // The story-time launcher by name, for the living-room reading session.
    // Exposed rather than reached for through `launchers` because two callers
    // need DIFFERENT things off it and both must have the SAME instance: the
    // interceptor asks `status()` to derive the assignment/browsing mode, and
    // `RecordStoryRead` takes `studyDay()` as its shard key. A second launcher
    // wired with its own timezone would file a 10pm read under tomorrow while
    // this one still read today — the count would never rise and nothing would
    // error. One instance is what makes that impossible.
    storyTimeLauncher: launchers.get(STORY_TIME_PROGRAM_ID) ?? null,
    // The SAME gate `gradeSubmission`/`closeSessionOutcome`/`resolveReviewItem`/
    // `setAssignments` already assert through — exposed so `app.mjs` can wire
    // Task 6's `CloseAcademicPeriod` (a parent-only write, same rule) without
    // constructing a second `GrownUpGate` against a possibly-stale roster read.
    grownUps,
    // The console write predicate — exposed for the same reason as grownUps:
    // app.mjs wires CloseAcademicPeriod and PrintService with THIS instance.
    teacherGate,
    // The same override store CloseSessionOutcome grades against — the
    // routes read/write THIS instance so a PUT is live at the next close.
    passOverrides,
    // The guarded save/archiveGuarded wrapper the router calls (never the raw
    // `YamlSyllabusStore`) — exposed for the same "same instance, not a second
    // one" reason as `passOverrides` above.
    syllabi,
  };
}

export default createSchoolLifecycle;
