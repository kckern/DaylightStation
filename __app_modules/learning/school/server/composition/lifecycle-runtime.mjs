/** Existing school lifecycle runtime assembly; preserves construction order. */
import { declaredEntryActions as declaredEntryActions } from "../domain/reachability.mjs";
import { resolveBookScanTarget as resolveBookScanTarget } from "./schoolBookScans.mjs";
import { storyBooksFromContentTags } from "./storyBookCorpus.mjs";
import { PrepareBookScan as PrepareBookScan } from "../application/usecases/PrepareBookScan.mjs";
import crypto from "node:crypto";
import { OpenBookShelfAtPanel as OpenBookShelfAtPanel } from "../application/usecases/OpenBookShelfAtPanel.mjs";
import { OpenBankAtPanel as OpenBankAtPanel } from "../application/usecases/OpenBankAtPanel.mjs";
import { TeacherCapabilitySessions as TeacherCapabilitySessions } from "../application/TeacherCapabilitySessions.mjs";
import { renderSessionResultPng as renderSessionResultPng } from "../rendering/documents/SessionResultRenderer.mjs";
import { studyDayForInstant as studyDayForInstant } from "../domain/studyDay.mjs";
import { GetSchoolReport as GetSchoolReport } from "../application/GetSchoolReport.mjs";
import { YamlConceptRegistry as YamlConceptRegistry } from "../adapters/progress/index.mjs";
import { PrintService as PrintService } from "../application/PrintService.mjs";
import { renderBankWorksheet as renderBankWorksheet } from "../rendering/WorksheetRenderer.mjs";
import { FilesystemWorksheetPdfReader as FilesystemWorksheetPdfReader } from "../adapters/documents/FilesystemWorksheetPdfReader.mjs";
import path from "path";
import { createSchoolRouter as createSchoolRouter } from "../api/school.mjs";
import { createSchoolApiServices as createSchoolApiServices } from "./schoolApi.mjs";
import * as schoolErrors from "../domain/errors.mjs";
import { RegradeBankAttempts as RegradeBankAttempts } from "../application/usecases/RegradeBankAttempts.mjs";
import { AdjustSessionGrade as AdjustSessionGrade } from "../application/usecases/AdjustSessionGrade.mjs";
import { GetTeacherSession as GetTeacherSession } from "../application/usecases/GetTeacherSession.mjs";
import { PreviewTeacherLessonMaterial as PreviewTeacherLessonMaterial } from "../application/usecases/PreviewTeacherLessonMaterial.mjs";
import { GetLearnerTimeline as GetLearnerTimeline } from "../application/usecases/GetTeacherSession.mjs";
import { RetractSessionGradeAdjustment as RetractSessionGradeAdjustment } from "../application/usecases/AdjustSessionGrade.mjs";
import { createArtifactPostviewRenderer as createArtifactPostviewRenderer } from "../rendering/documents/ArtifactPostviewRenderer.mjs";
import { renderPdfFirstPagePng as renderPdfFirstPagePng } from "../rendering/documents/ArtifactPostviewRenderer.mjs";
import { GetLearnerRecord as GetLearnerRecord } from "../application/usecases/GetLearnerRecord.mjs";
import { createSentenceLadderRouter as createSentenceLadderRouter } from "../api/sentenceLadder.mjs";
import { createLanguageReelsRouter as createLanguageReelsRouter } from "../api/languageReels.mjs";
import { createRubiksCubeRouter as createRubiksCubeRouter } from "../api/rubiksCube.mjs";
import { RUBIKS_CUBE_REVISION as RUBIKS_CUBE_REVISION } from "../application/rubiksCube/courseCatalog.mjs";
import { createSchoolBookScansRouter as createSchoolBookScansRouter } from "../api/schoolBookScans.mjs";
import { createSchoolBooksRouter as createSchoolBooksRouter } from "../api/schoolBooks.mjs";
import { BookEntryPolicy as BookEntryPolicy } from "../application/BookEntryPolicy.mjs";

export async function createSchoolLifecycleRuntime(dependencies) {
  const { nfcLocationsForReachability, configService, householdId, schoolService, schoolAcademicPeriods, schoolDatastore, economyApi, userService, eventBus, printerRegistry, wakeScreenForBroadcast, languageStudyService, languageReelService, pianoContainer, schoolPianoChallengeCompletionService, fitnessPlayableService, v1Routers, schoolLearningEvidence, flashcardStudy, cardLadderStudy, rubiksCubeService, books, kioskFrictionTracker, schoolLifecycleLogger, getSchoolScreenConfig, schoolLearnerDirectory, stateGatesModule, schoolStateGatesPrincipal, stateGatesProducerScheduler, rootLogger, schoolTeacherGate, schoolSessionResultArtifacts, homeAutomationAdapters, learnerDisplayName, omrReadersConfig, NodeAsyncScheduler, dataDir, getLearningProgress, fitnessServices, schoolFullConfig, LaserPrinterAdapter, schoolSurfaces, schoolEnrichmentLog, schoolMilestoneStore, cardLadderTest, cardLadderConfig, flashcardAssets, schoolMaterialProgressStore, getInstructionalInsights, schoolCatalog, openCatalogLearningSession, recordLearningReflection, schoolLearningLoop, offerCatalogQuizRemediation, schoolTeacherConfig, mediaBasePath, languageTranscription, createBooksApiRouter } = dependencies;
  const { SetAcademicPeriods: SetAcademicPeriods } = await import("../application/usecases/SetAcademicPeriods.mjs");
  const { SetPassOverride: SetPassOverride } = await import("../application/usecases/SetPassOverride.mjs");
  const { SetMilestones: SetMilestones } = await import("../application/usecases/SetMilestones.mjs");
  const { GetMilestoneStatuses: GetMilestoneStatuses } = await import("../application/usecases/GetMilestoneStatuses.mjs");
  const { RecordEnrichment: RecordEnrichment } = await import("../application/usecases/RecordEnrichment.mjs");
try {
    const { createSchoolLifecycle } = await import("./schoolLifecycle.mjs");
    dependencies.schoolLifecycle = await createSchoolLifecycle({
      // Deliberately a THUNK: the trigger API that owns the parsed sources is
      // composed further down this file, so there is no value to read yet. It
      // resolves per projection, which also means a reloaded trigger config is
      // picked up without restarting School.
      declaredEntryActions: () => declaredEntryActions(nfcLocationsForReachability()),
      configService,
      householdId,
      schoolService,
      // The term grid's term is one of the household's academic periods —
      // the same instance the report cards and `/periods` read.
      academicPeriods: schoolAcademicPeriods,
      attemptDatastore: schoolDatastore,
      economyService: economyApi.economyService,
      // The agenda's economy line prints only while coins are live.
      economyMode: () => economyApi.configProjection?.catalog?.().mode ?? 'off',
      // What "print my next sheet" is worth (`GET .../next`). A late-bound
      // thunk: the earnings runtime that answers it is built after School.
      rewardFor: economyApi.rewardFor ?? null,
      userService,
      eventBus,
      thermalPrinterRegistry: printerRegistry,
      // §8's real playback target: School builds a `ScreenPlaybackAdapter`
      // around this rather than waking a TV itself.
      //
      // NOT `wakeAndLoadService`. That service ends in a content load, and on
      // the living-room Shield a content load is an unconditional FKB
      // `loadURL` — a page load, which drops the very WebSocket the lesson is
      // about to be announced on. `wakeScreenForBroadcast` is the reading
      // path's seam and is shared with it verbatim, one room, one way to wake
      // a screen that a mounted widget is about to be told something on.
      wakeScreen: wakeScreenForBroadcast,
      startReadingSession: (args) => dependencies.startReadingSession?.(args) ?? { status: 'reading_session_failed', message: 'Story time is still starting up.' },
      // The NFC book stickers, asked of the trigger owner on every refusal so
      // a sticker added after boot is suggested without a restart. Null until
      // the trigger API exists.
      storyCorpus: () => storyBooksFromContentTags(dependencies.contentTagsForStoryTime?.() ?? null),
      languageStudyService,
      studyGrants: dependencies.schoolStudyGrants,
      languageReelService,
      languageReelGrants: dependencies.schoolReelGrants,
      launchPreviewTokens: dependencies.schoolLaunchPreviewTokens,
      // Piano's own use case, so School's piano-course program reads exactly
      // what the kiosk reads (progress, sequential gating, co-progress lock)
      // instead of a second implementation that could disagree with it.
      pianoPlayableUnits: pianoContainer?.getPlayableUnits?.() ?? null,
      schoolPianoChallengeCompletionService,
      fitnessPlayableService,
      fitnessSchoolCourseService: v1Routers.fitness?.fitnessSchoolCourseService ?? null,
      learningEvidenceRepository: schoolLearningEvidence,
      // The stale sweep's roster. Without it `MarkSessionAbandoned.listStale`
      // sees no learners, and the nightly `school-stale-sweep` job reports
      // `swept: 0` while issued-and-never-graded work reprints forever.
      learnerDirectory: schoolLearnerDirectory,
      // Same adapter class the grading hook uses, pointed at its own
      // `school.yml` block. Guarded on the HA gateway exactly as the grading
      // hook is: no Home Assistant means the Portal banner still fires and
      // only the chime is absent.
      pianoLessonHook: dependencies.pianoLessonHook,
      flashcardStudyService: flashcardStudy,
      cardLadderStudyService: cardLadderStudy,
      rubiksCubeService,
      rubiksCubeGrants: dependencies.schoolCubeGrants,
      // The reading shelf (book-log program): grants for the panel's /act
      // target, the Books domain's resolver and repository for the shelf.
      bookGrants: dependencies.schoolBookGrants,
      resolveBook: books.resolveBook,
      bookRepository: books.bookRepository,
      // Shelf and teacher views render covers from OUR address, never the
      // provider's — see `4_api/v1/routers/books.mjs#bookCoverPath`.
      bookCoverUrlFor: books.coverUrlFor,
      donow: dependencies.donowModule?.service ?? null,
      donowSurfaces: dependencies.donowModule?.surfaces ?? null,
      donowDatastore: dependencies.donowModule?.datastore ?? null,
      tokenRegistry: dependencies.schoolCalc.tokenRegistry ?? null,
      schoolCalcActionResolver: dependencies.schoolCalc.actionResolver ?? null,
      schoolCalcStudies: dependencies.schoolCalc.wired ? dependencies.schoolCalc.studySessions : null,
      // Same instance Task 3's router reads — a rejected panel code is the
      // first real friction signal source (see the `kioskFrictionTracker`
      // construction above, alongside `kioskFrictionStateGatesPrincipal`).
      kioskFrictionTracker,
      logger: schoolLifecycleLogger
    });
  } catch (err) {
    // A console that cannot be built must not stop the house from booting: the
    // rest of School (banks, materials, language) is untouched by its absence.
    schoolLifecycleLogger.error('school.lifecycle.wiring-failed', { error: err.message });
  }
  let schoolStateGatesProducer = null;
  const bookScanTarget = resolveBookScanTarget({ configService, householdId, getScreenConfig: getSchoolScreenConfig });
  const bookScans = dependencies.schoolLifecycle.bookLogLauncher && dependencies.schoolLifecycle.realtime ? new PrepareBookScan({
    mintId: () => crypto.randomBytes(32).toString('base64url'),
    resolveBook: books.resolveBook,
    roster: () => schoolLearnerDirectory.listLearners(),
    issueLaunchTarget: args => dependencies.schoolLifecycle.bookLogLauncher.issueLaunchTarget(args),
    wake: args => wakeScreenForBroadcast({ ...args, prepareOnly: bookScanTarget?.prepareOnly === true }),
    notifications: dependencies.schoolLifecycle.realtime,
    target: bookScanTarget,
    logger: schoolLifecycleLogger,
  }) : null;
  // The second door: a learner tapped on the panel, no code and no barcode.
  // It needs no realtime — nothing is broadcast and nothing waits.
  const openBookShelfAtPanel = dependencies.schoolLifecycle.bookLogLauncher && dependencies.schoolBookPanelGrants && bookScanTarget
    ? new OpenBookShelfAtPanel({
      roster: () => schoolLearnerDirectory.listLearners(),
      issueLaunchTarget: ({ userId }) => ({
        kind: 'program',
        program: dependencies.schoolLifecycle.bookLogLauncher.id,
        learnerId: userId,
        bookGrant: dependencies.schoolBookPanelGrants.issue({ learnerId: userId }),
      }),
      target: bookScanTarget,
      logger: schoolLifecycleLogger,
    })
    : null;
  // A missing door is invisible on the panel — the icon simply is not drawn —
  // so say which piece was absent rather than leaving it to be rediscovered.
  if (!openBookShelfAtPanel) {
    schoolLifecycleLogger.warn('school.book-shelf.panel-door-unavailable', {
      launcher: Boolean(dependencies.schoolLifecycle.bookLogLauncher),
      grants: Boolean(dependencies.schoolBookPanelGrants),
      target: Boolean(bookScanTarget),
    });
  }

  // The coin bank's door on the same panel (economy slice 1, C3): the shelf
  // door's two checks (roster, a configured panel) and nothing minted. The
  // bank is a screen, not a program run, so it needs no lifecycle launcher.
  const openBankAtPanel = bookScanTarget
    ? new OpenBankAtPanel({
      roster: () => schoolLearnerDirectory.listLearners(),
      target: bookScanTarget,
      logger: schoolLifecycleLogger,
    })
    : null;
  if (!openBankAtPanel) {
    schoolLifecycleLogger.warn('school.bank.panel-door-unavailable', { target: false });
  }

  if (dependencies.schoolLifecycle.wired && dependencies.schoolLifecycle.realtime && dependencies.schoolLifecycle.getLearnerDayCompletion) {
    try {
      const { SchoolStateGatesProducer } = await import("../application/SchoolStateGatesProducer.mjs");
      schoolStateGatesProducer = new SchoolStateGatesProducer({
        realtime: dependencies.schoolLifecycle.realtime,
        getLearnerDayCompletion: dependencies.schoolLifecycle.getLearnerDayCompletion,
        learners: () => schoolLearnerDirectory.listLearners(),
        publishAssertion: (assertion) => stateGatesModule.ingress.observe(
          householdId, schoolStateGatesPrincipal, assertion,
        ),
        retractAssertion: (command) => stateGatesModule.ingress.retract(
          householdId, schoolStateGatesPrincipal, command,
        ),
        timezone: configService.getHouseholdTimezone?.(householdId) || 'UTC',
        scheduler: stateGatesProducerScheduler,
        logger: rootLogger.child({ module: 'state-gates-school-producer' }),
      });
      await schoolStateGatesProducer.start();
    } catch (err) {
      schoolStateGatesProducer?.stop();
      schoolStateGatesProducer = null;
      schoolLifecycleLogger.error('school.state-gates-producer.wiring-failed', { error: err.message });
    }
  }
  const teacherCapabilitySessions = new TeacherCapabilitySessions({
    teacherGate: schoolTeacherGate,
    tokenFactory: () => crypto.randomBytes(32).toString('base64url'),
  });
  schoolTeacherGate.bindCapabilitySessions(teacherCapabilitySessions);
  if (typeof dependencies.schoolLifecycle.teacherGate?.bindCapabilitySessions === 'function'
      && dependencies.schoolLifecycle.teacherGate !== schoolTeacherGate) {
    dependencies.schoolLifecycle.teacherGate.bindCapabilitySessions(teacherCapabilitySessions);
  }

  // Print-document scan-back (Task 7, spec §9): ResolveCardScan joins the
  // SAME decoded-scan stream createQuizScanRecorder (wired much earlier,
  // above) already persists — see schoolPrintScanConsumer.mjs's own header.
  // Reuses schoolLifecycle's OWN allocationStore/printDocuments repository
  // instances (not fresh ones) so a live scan resolves against exactly what
  // IssueDocument's tracked-quiz path just wrote — two YamlAllocationStore
  // instances pointed at the same directory would each serialize their OWN
  // writes but not against each other, a real read-modify-write race this
  // avoids by construction. Wired only once the lifecycle itself is (no
  // lifecycle, no allocationStore/repository to resolve against either).
  if (dependencies.schoolLifecycle.wired && dependencies.schoolLifecycle.stores?.allocationStore && dependencies.schoolLifecycle.stores?.printDocuments) {
    try {
      const { createSchoolPrintScanConsumer } = await import("./schoolPrintScanConsumer.mjs");
      const resolveCardScan = dependencies.schoolLifecycle.useCases?.resolveCardScan;
      if (!resolveCardScan) throw new Error('school lifecycle did not expose resolveCardScan');
      // B1 (review wave): graded scans become durable evidence — per-learner
      // attempt records through the SAME datastore the on-screen quiz engine
      // writes, plus the session bridge (submitted → graded) for cards whose
      // allocation record carries its issuing session.
      const { RecordCardScanOutcome } = await import("../application/documents/RecordCardScanOutcome.mjs");
      const recordCardScanOutcome = new RecordCardScanOutcome({
        datastore: schoolDatastore,
        sessions: dependencies.schoolLifecycle.stores.sessions ?? null,
        reviewQueue: dependencies.schoolLifecycle.stores.reviewQueue ?? null,
        resultArtifacts: schoolSessionResultArtifacts,
        renderMachineResult: renderSessionResultPng,
        logger: rootLogger.child({ module: 'school-print-scan-record' }),
      });
      dependencies.schoolLifecycle.useCases?.reviewHeldCardScan?.bindOutcomeRecorder(recordCardScanOutcome);
      // Grading hook (Task 4, spec §grading-hook): fires one HA script per
      // terminal scan outcome. Guarded on `homeAutomationAdapters.haGateway`
      // the SAME way `homeApi.mjs`'s `callHomeAssistantService` is — a
      // household with no Home Assistant configured gets `gradingHook: null`
      // and boots exactly as it did before this task existed.
      //
      // Own try/catch, deliberately separate from the outer one wrapping this
      // whole block (final review Fix 2): the outer catch's job is "the print
      // scan-back consumer failed to wire, skip it" — but this construction
      // used to run BEFORE `createSchoolPrintScanConsumer` inside that SAME
      // outer try, so a broken import or constructor here (home automation's
      // problem) would trip the outer catch and take the entire scan-back
      // consumer down with it: no scan resolves, nothing is recorded, for the
      // whole process lifetime. Home automation must never be able to do
      // that, so a failure here degrades to `gradingHook: null` and the
      // consumer below is still created.
      let gradingHook = null;
      if (homeAutomationAdapters.haGateway) {
        try {
          const { SchoolGradingHookAdapter } = await import("../adapters/SchoolGradingHookAdapter.mjs");
          gradingHook = new SchoolGradingHookAdapter({
            gateway: homeAutomationAdapters.haGateway,
            // Same accessor/call shape `getPrintTeacherPin` above uses for this
            // same `school.yml` — the household-id arg is accepted for the
            // adapter's contract but this module always resolves against `null`.
            loadSchoolConfig: () => configService.getHouseholdAppConfig(null, 'school') || {},
            resolveStudent: learnerDisplayName,
            logger: rootLogger.child({ module: 'school-grading-hook' }),
          });
        } catch (err) {
          gradingHook = null;
          schoolLifecycleLogger.warn('school.grading_hook.wiring-failed', { error: err.message });
        }
      }
      createSchoolPrintScanConsumer({
        eventBus,
        config: omrReadersConfig,
        resolveCardScan,
        recordCardScanOutcome,
        closeSessionOutcome: dependencies.schoolLifecycle.useCases?.closeSessionOutcome ?? null,
        gradingHook,
        // Every non-graded feed prints a notice slip through the same
        // thermal printer the result receipts use (2026-09-15).
        receipts: dependencies.schoolLifecycle.receipts ?? null,
        printDocuments: dependencies.schoolLifecycle.stores.printDocuments,
        // Phone-copy labels (2026-09-22 push redesign): course short titles
        // from the catalog, display names, and today's study day so late
        // work can say which day it was for.
        curriculum: dependencies.schoolLifecycle.stores.curriculum ?? null,
        studentName: learnerDisplayName,
        // Same zone school's study days use (schoolLifecycle's `timezone`, fed
        // to CloseSessionOutcome and the piano bridge), so on-time work near
        // the 4 AM boundary never reads as late.
        today: () => studyDayForInstant(Date.now(), { timezone: configService.getTimezone?.() || null }),
        // Bounds the label lookups (default 2s) so a hung catalog/name read can
        // never withhold the hook and, with it, the room siren.
        scheduler: new NodeAsyncScheduler(),
        logger: rootLogger.child({ module: 'school-print-scan' }),
      });
    } catch (err) {
      schoolLifecycleLogger.error('school.print.scan-consumer-wiring-failed', { error: err.message });
    }
  }

  const getSchoolReport = new GetSchoolReport({
    // The lifecycle reporter is filtered out by GetSchoolReport itself when it
    // is null, so an unwired console simply does not appear on the board.
    reporters: [schoolService, languageStudyService, dependencies.schoolLifecycle.reporter],
    userService,
    cohortDirectory: schoolLearnerDirectory,
    logger: rootLogger.child({ module: 'school-report' })
  });

  // Concept registry (Task 10, R8) — household concept labels for the report
  // card's `concepts` facet (`data/content/school/concepts.yml`). Its own
  // narrow try/catch, independent of the report-card gate below: a
  // missing file degrades to an empty registry inside the adapter itself
  // (never throws), but a PRESENT, malformed one does throw at construction
  // — and that must disable only concept LABELING, never the report card
  // (or the rest of School) entirely. `GetReportCard` already falls back to
  // the raw conceptId as its own label whenever `conceptRegistry` is null.
  let schoolConceptRegistry = null;
  try {
    schoolConceptRegistry = new YamlConceptRegistry({ dataDir });
  } catch (err) {
    schoolLifecycleLogger.error('school.concept-registry.wiring-failed', { error: err.message });
  }

  // Report cards, period close, teacher digest (Task 6, spec R5b). Needs the
  // lifecycle's shared curriculum/sessions/assignments stores AND the SAME
  // grown-up gate every other parent-only write already asserts through
  // (`schoolLifecycle.grownUps`) — tolerant of an unwired lifecycle exactly
  // like the print-scan consumer above: no sessions store, no report cards,
  // rather than a half-built feature reaching for a store that isn't there.
  let getReportCard = null;
  let closeAcademicPeriod = null;
  let getTeacherToday = null;
  if (dependencies.schoolLifecycle.wired && dependencies.schoolLifecycle.stores?.sessions && dependencies.schoolLifecycle.stores?.assignments
      && dependencies.schoolLifecycle.stores?.curriculum && dependencies.schoolLifecycle.grownUps) {
    try {
      const { GetReportCard } = await import("../application/usecases/GetReportCard.mjs");
      const { CloseAcademicPeriod } = await import("../application/usecases/CloseAcademicPeriod.mjs");
      const { GetTeacherToday } = await import("../application/usecases/GetTeacherToday.mjs");
      getReportCard = new GetReportCard({
        curriculum: dependencies.schoolLifecycle.stores.curriculum,
        assignments: dependencies.schoolLifecycle.stores.assignments,
        sessions: dependencies.schoolLifecycle.stores.sessions,
        datastore: schoolDatastore,
        academicPeriods: schoolAcademicPeriods,
        getMaterialProgressSummary: dependencies.getMaterialProgressSummary,
        getLearningProgress,
        reviewQueue: dependencies.schoolLifecycle.stores.reviewQueue ?? null,
        conceptRegistry: schoolConceptRegistry,
        logger: rootLogger.child({ module: 'school-report-card' })
      });
      closeAcademicPeriod = new CloseAcademicPeriod({
        teacherGate: dependencies.schoolLifecycle.teacherGate ?? null,
        getReportCard,
        datastore: schoolDatastore,
        grownUps: dependencies.schoolLifecycle.grownUps,
        logger: rootLogger.child({ module: 'school-report-card' })
      });
      getTeacherToday = new GetTeacherToday({
        learnerDirectory: schoolLearnerDirectory,
        datastore: schoolDatastore,
        sessions: dependencies.schoolLifecycle.stores.sessions,
        reviewQueue: dependencies.schoolLifecycle.stores.reviewQueue ?? null,
        evidenceRepository: schoolLearningEvidence ?? null,
        curriculum: dependencies.schoolLifecycle.stores.curriculum,
        bookLog: dependencies.schoolLifecycle.stores.bookLog ?? null,
        // Physical-education credit on the day board. The same session
        // summaries the weekly ring measure reads, so the disc and the ring
        // chip can never disagree about a workout.
        fitnessSessions: {
          listSessionsInRange: (from, to) => fitnessServices.sessionService
            .listSessionsInRange(from, to, householdId),
        },
        timezone: configService.getTimezone?.() || null,
        planProjection: dependencies.schoolLifecycle.planProjection ?? null,
        logger: rootLogger.child({ module: 'school-teacher-today' })
      });
    } catch (err) {
      schoolLifecycleLogger.error('school.report-card.wiring-failed', { error: err.message });
    }
  }

  // Printable report card (Task 7, spec R5b adequacy MUST 2) — a bespoke
  // pdfkit renderer under `1_rendering/school/reportcard/`, sharing the
  // `documents/` theme's fonts but none of the block-pipeline machinery.
  // Unlike the three use cases just above, this has no lifecycle store
  // dependency at all — constructed unconditionally, so `format=pdf` works
  // on any wired report-card route regardless of the (independent) lifecycle
  // gate those routes' own use cases are behind.
  let renderReportCardPdf = null;
  try {
    const { createReportCardPdfRenderer } = await import("../rendering/reportcard/ReportCardRenderer.mjs");
    renderReportCardPdf = createReportCardPdfRenderer();
  } catch (err) {
    schoolLifecycleLogger.error('school.report-card.pdf-wiring-failed', { error: err.message });
  }

  // Printing (worksheets → kitchen laser printer). Wired only when the school
  // config declares a `printer` host — no printer, no print feature (the
  // router serves inert). The printer host defaults to the `kitchen-printer`
  // device entry so config need only opt in.
  let schoolPrintService = null;
  const printerHost = schoolFullConfig.printing?.host
    || configService.getDeviceConfig?.('kitchen-printer')?.host
    || null;
  if (printerHost && (schoolFullConfig.printables?.length || schoolFullConfig.printing)) {
    const laserPrinter = new LaserPrinterAdapter({
      host: printerHost,
      port: schoolFullConfig.printing?.port || 631,
      path: schoolFullConfig.printing?.path || '/ipp/print',
      // Double-sided by default; `school.yml` printing.duplex/.binding override.
      duplex: schoolFullConfig.printing?.duplex ?? true,
      binding: schoolFullConfig.printing?.binding || 'LONGEDGE',
      // Renders at most this many pages of a document. Distinct from
      // `maxPagesPerJob`, which REFUSES an oversized job — this one TRIMS, so a
      // supervised hardware test can ask for exactly one page and still get a
      // real print rather than a refusal. Unset in normal operation.
      renderPageLimit: schoolFullConfig.printing?.renderPageLimit ?? null,
      logger: rootLogger.child({ module: 'school-print' })
    });
    // Paper-certification gate (Task 15, spec §9/§11): a `bank` printable is
    // offered only if AT LEAST ONE paper surface profile can render it —
    // built straight from the surfaces registry's family:'paper' ports/
    // profiles rather than through GetSurfaceCertification, which certifies
    // whole lessons, not standalone banks. `schoolSurfaces.registry` is null
    // whenever the School Catalog itself is not wired; no paper profile
    // authored yields the same `null` — PrintService then falls back to its
    // legacy, ungated `listPrintables()` byte-for-byte.
    const paperProfiles = schoolSurfaces.registry
      ? schoolSurfaces.registry.list().filter((profile) => profile.family === 'paper')
      : [];
    const paperCertifyBank = paperProfiles.length
      ? (bank) => {
        const results = paperProfiles.map((profile) => schoolSurfaces.registry.portFor(profile).certifyBank(bank, profile));
        if (results.some((r) => r.verdict === 'render')) return { verdict: 'render', reasons: [] };
        return { verdict: 'incompatible', reasons: results.flatMap((r) => r.reasons || []) };
      }
      : null;
    schoolPrintService = new PrintService({
      config: schoolFullConfig,
      datastore: schoolDatastore,
      printerAdapter: laserPrinter,
      worksheetRenderer: { renderBankWorksheet },
      // getBank throws on miss; PrintService wants null-on-miss.
      bankReader: { getBank: (id) => { try { return schoolService.getBank(id); } catch { return null; } } },
      pdfReader: new FilesystemWorksheetPdfReader({ rootDir: path.join(configService.getDataDir(), 'household', 'content', 'worksheets') }),
      userService,
      paperCertifyBank,
      teacherGate: dependencies.schoolLifecycle.teacherGate ?? null,
      logger: rootLogger.child({ module: 'school-print' })
    });
    rootLogger.child({ module: 'school-print' }).info?.('school.print.ready', { host: printerHost, printables: schoolFullConfig.printables?.length || 0, paperCertified: paperProfiles.length > 0 });
  }

  // Teacher console picker (teacher-console spec §4.7.1): config-declared
  // `teachers:` ids resolved against the LIVE roster per request — never a
  // boot-time snapshot, and only {id, name} ever leaves. Deliberately NOT
  // lifecycle-gated: the teachers read works on any install.
  const { GetTeachers } = await import("../application/usecases/GetTeachers.mjs");
  const getTeachers = new GetTeachers({
    teachers: () => (configService.getHouseholdAppConfig(null, 'school') || {}).teachers,
    roster: () => userService.getHouseholdRoster(householdId) ?? [],
    logger: rootLogger.child({ module: 'school-teachers' }),
  });

  // Wave-5 repair stores + gated writes (spec D1/D2/D3).
  const { YamlAttestationLog } = await import("../adapters/persistence/YamlAttestationLog.mjs");
  const { YamlTeacherNotes } = await import("../adapters/persistence/YamlTeacherNotes.mjs");
  const { RecordAttestation } = await import("../application/usecases/RecordAttestation.mjs");
  const { ManageEarnRules } = await import("../application/usecases/ManageEarnRules.mjs");
  const { RecordTeacherNote } = await import("../application/usecases/RecordTeacherNote.mjs");
  const { ReassignEvidence } = await import("../application/usecases/ReassignEvidence.mjs");
  const { YamlReassignmentLog } = await import("../adapters/persistence/YamlReassignmentLog.mjs");
  const schoolAttestations = new YamlAttestationLog({ configService, logger: rootLogger.child({ module: 'school-attestations' }) });
  const schoolTeacherNotes = new YamlTeacherNotes({ configService, logger: rootLogger.child({ module: 'school-teacher-notes' }) });
  const recordAttestation = new RecordAttestation({ log: schoolAttestations, teacherGate: schoolTeacherGate, notes: schoolTeacherNotes });
  const recordTeacherNote = new RecordTeacherNote({ notes: schoolTeacherNotes, teacherGate: schoolTeacherGate, logger: rootLogger.child({ module: 'school-planning' }) });
  // The grown-up's reading verbs (teacher reading admin design §3). Wired
  // only where the shelf itself is: without a book log there is nothing to
  // correct, and every route answers an honest 404 rather than half-working.
  // `bookLogLauncher` comes from the lifecycle module by name so the window a
  // re-dated day is judged against is the same one the agenda counts with.
  const teacherReadingUseCases = dependencies.schoolLifecycle.stores?.bookLog && schoolTeacherGate
    ? await (async () => {
      const [
        { GetLearnerReadings }, { UpdateReading }, { AddReadingEntry }, { UpdateReadingEntry },
        { DeleteReadingEntry }, { AddReadingForLearner }, { MoveReading }, { DeleteReading },
        { UndoReadingRevision }, { GetBookReaders },
      ] = await Promise.all([
        import("../application/usecases/teacher/GetLearnerReadings.mjs"),
        import("../application/usecases/teacher/UpdateReading.mjs"),
        import("../application/usecases/teacher/AddReadingEntry.mjs"),
        import("../application/usecases/teacher/UpdateReadingEntry.mjs"),
        import("../application/usecases/teacher/DeleteReadingEntry.mjs"),
        import("../application/usecases/teacher/AddReadingForLearner.mjs"),
        import("../application/usecases/teacher/MoveReading.mjs"),
        import("../application/usecases/teacher/DeleteReading.mjs"),
        import("../application/usecases/teacher/UndoReadingRevision.mjs"),
        import("../application/usecases/teacher/GetBookReaders.mjs"),
      ]);
      const shared = {
        bookLog: dependencies.schoolLifecycle.stores.bookLog,
        teacherGate: schoolTeacherGate,
        recordTeacherNote,
        bookRepository: dependencies.schoolLifecycle.stores?.bookRepository ?? null,
        bookLogLauncher: dependencies.schoolLifecycle.bookLogLauncher ?? null,
        // One cover address for both surfaces: what the grown-up sees in the
        // console is byte-for-byte what the child sees on the panel.
        coverUrlFor: books.coverUrlFor,
        logger: rootLogger.child({ module: 'school-teacher-reading' }),
      };
      return {
        getLearnerReadings: new GetLearnerReadings(shared),
        updateReading: new UpdateReading(shared),
        addReadingEntry: new AddReadingEntry(shared),
        updateReadingEntry: new UpdateReadingEntry(shared),
        deleteReadingEntry: new DeleteReadingEntry(shared),
        addReadingForLearner: new AddReadingForLearner(shared),
        moveReading: new MoveReading(shared),
        deleteReading: new DeleteReading(shared),
        undoReadingRevision: new UndoReadingRevision(shared),
        // The quick-log sheet's read: one book against every enrolled learner.
        getBookReaders: new GetBookReaders({ ...shared, roster: () => schoolLearnerDirectory.listLearners() }),
      };
    })()
    : {};

  // Task 12 (debt M5): reassignments write their own audit trail — a
  // best-effort append that never blocks or unwinds the move itself.
  const schoolReassignmentLog = new YamlReassignmentLog({ configService, logger: rootLogger.child({ module: 'school-reassignments' }) });
  const reassignEvidence = new ReassignEvidence({
    datastore: schoolDatastore, teacherGate: schoolTeacherGate, notes: schoolTeacherNotes,
    auditLog: schoolReassignmentLog, logger: rootLogger.child({ module: 'school-reassignments' }),
  });
  // Its session-level twin (plan 4.1) — the repair for work with no machine
  // attempts to move. Shares the ONE audit-log instance above deliberately: a
  // second `YamlReassignmentLog` would race that instance's append chain.
  // Null when the lifecycle is unwired (no sessions repo, nothing to move),
  // which 404s the route rather than half-answering it.
  const { ReassignSession } = await import("../application/usecases/ReassignSession.mjs");
  const schoolSessionsRepo = dependencies.schoolLifecycle.stores?.sessions ?? null;
  const reassignSession = schoolSessionsRepo
    ? new ReassignSession({
      sessions: schoolSessionsRepo, teacherGate: schoolTeacherGate, notes: schoolTeacherNotes,
      auditLog: schoolReassignmentLog, logger: rootLogger.child({ module: 'school-reassignments' }),
    })
    : null;
  const { RetractTeacherRecord } = await import("../application/usecases/RetractTeacherRecord.mjs");
  const retractTeacherRecord = new RetractTeacherRecord({
    stores: { enrichment: schoolEnrichmentLog, attestation: schoolAttestations, note: schoolTeacherNotes },
    teacherGate: schoolTeacherGate,
    notes: schoolTeacherNotes,
    logger: rootLogger.child({ module: 'school-planning' }),
  });
  const { GetTranscript } = await import("../application/usecases/GetTranscript.mjs");
  const getTranscript = new GetTranscript({ reportCardsStore: schoolDatastore });
  const { createTranscriptPdfRenderer } = await import("../rendering/reports/TranscriptRenderer.mjs");
  const { createSyllabusPdfRenderer } = await import("../rendering/reports/SyllabusRenderer.mjs");
  // Wave-3 gated planning writes — constructed HERE because they borrow the
  // lifecycle's pass-override store and sessions repo (both null-safe when
  // the lifecycle is unwired).
  const setAcademicPeriods = new SetAcademicPeriods({
    store: schoolAcademicPeriods,
    teacherGate: schoolTeacherGate,
    logger: rootLogger.child({ module: 'school-planning' }),
    // Frozen-card guard (admin advocacy #15): the roster-wide set of periodIds
    // holding a FROZEN card — removing/renaming one of those ids is refused.
    frozenPeriodIds: async () => {
      const roster = userService.getHouseholdRoster?.() ?? [];
      const ids = [];
      for (const member of roster) {
        try {
          (schoolDatastore.listReportCards(member.id) ?? []).forEach((r) => { if (r?.periodId) ids.push(r.periodId); });
        } catch { /* one unreadable shard must not lock period edits */ }
      }
      return ids;
    },
  });
  const setPassOverride = dependencies.schoolLifecycle.passOverrides
    ? new SetPassOverride({ store: dependencies.schoolLifecycle.passOverrides, teacherGate: schoolTeacherGate, logger: rootLogger.child({ module: 'school-planning' }) })
    : null;
  const setMilestones = new SetMilestones({ store: schoolMilestoneStore, teacherGate: schoolTeacherGate, logger: rootLogger.child({ module: 'school-planning' }) });
  const milestoneStatuses = new GetMilestoneStatuses({
    store: schoolMilestoneStore, sessions: dependencies.schoolLifecycle.stores?.sessions ?? null,
    attestations: schoolAttestations,
    timezone: configService.getTimezone?.() || null,
  });
  const recordEnrichment = new RecordEnrichment({ log: schoolEnrichmentLog, teacherGate: schoolTeacherGate, logger: rootLogger.child({ module: 'school-planning' }) });
  // Wave-4 records: the progress-report read model + the two renderers.
  let getProgressReport = null;
  if (getReportCard) {
    const { GetProgressReport } = await import("../application/usecases/GetProgressReport.mjs");
    getProgressReport = new GetProgressReport({
      getReportCard,
      milestoneStatuses,
      enrichmentLog: schoolEnrichmentLog,
      timezone: configService.getTimezone?.() || null,
    });
  }
  const { offsetMinutesFor: schoolOffsetMinutesFor } = await import("../domain/studyDay.mjs");
  const { createProgressReportPdfRenderer } = await import("../rendering/reports/ProgressReportRenderer.mjs");
  const { createCertificatePdfRenderer } = await import("../rendering/reports/CertificateRenderer.mjs");

  v1Routers.school = createSchoolRouter(createSchoolApiServices({
    schoolErrors,
    openBankAtPanel,
    schoolService,
    flashcardStudy,
    cardLadderStudy,
    cardLadderTest,
    cardLadderTuning: dependencies.cardLadderTuning?.service ?? null,
    cardLadderStageScreen: cardLadderConfig.stage?.screen ?? null,
    flashcardAssets,
    getMaterialCatalog: dependencies.getMaterialCatalog,
    getMaterialUnits: dependencies.getMaterialUnits,
    getMaterialProgressSummary: dependencies.getMaterialProgressSummary,
    materialProgressStore: schoolMaterialProgressStore,
    getSchoolReport,
    getLearningProgress,
    getInstructionalInsights,
    learningCatalog: schoolCatalog.query,
    issueContinuationCode: dependencies.issueContinuationCode,
    openCatalogLearningSession,
    recordLearningReflection,
    recordLearningProbeInteraction: schoolLearningLoop.probeInteractions,
    remediationTutor: schoolLearningLoop.tutor,
    offerCatalogQuizRemediation,
    learnerDirectory: schoolLearnerDirectory,
    printService: schoolPrintService,
    academicPeriodStore: schoolAcademicPeriods,
    schoolDatastore,
    regradeBankAttempts: schoolTeacherGate ? new RegradeBankAttempts({
      datastore: schoolDatastore,
      bankReader: schoolService,
      teacherGate: schoolTeacherGate,
      learnerDirectory: schoolLearnerDirectory,
      sessions: dependencies.schoolLifecycle.stores?.sessions ?? null,
      worksheetInstances: dependencies.schoolLifecycle.stores?.worksheetInstances ?? null,
      // A systematic bank correction must update the session's effective
      // grade through the same append-only, reward-aware path as a one-off
      // teacher adjustment. That path also creates the corrected receipt
      // artifact; regrading attempts alone must never pretend history changed.
      sessionCorrection: dependencies.schoolLifecycle.stores?.sessions ? async (args) => new AdjustSessionGrade({
        realtime: dependencies.schoolLifecycle.realtime,
        sessions: dependencies.schoolLifecycle.stores.sessions,
        teacherGate: schoolTeacherGate,
        passOverrides: dependencies.schoolLifecycle.passOverrides ?? null,
        worksheetInstances: dependencies.schoolLifecycle.stores.worksheetInstances ?? null,
        reviewQueue: dependencies.schoolLifecycle.stores.reviewQueue ?? null,
        curriculum: dependencies.schoolLifecycle.stores.curriculum ?? null,
        economy: economyApi.economyService,
        economyEnabled: schoolFullConfig.lifecycle?.economy?.enabled === true,
        receiptIssuer: dependencies.schoolLifecycle.useCases?.issueCorrectedResultReceipt ?? null,
        logger: rootLogger.child({ module: 'school-systematic-regrade' }),
      }).execute(args) : null,
      logger: rootLogger.child({ module: 'school-regrade' }),
    }) : null,
    getTeacherSession: dependencies.schoolLifecycle.stores?.sessions
      ? new GetTeacherSession({
        sessions: dependencies.schoolLifecycle.stores.sessions,
        curriculum: dependencies.schoolLifecycle.stores.curriculum ?? null,
        issuedArtifacts: dependencies.schoolLifecycle.stores.issuedArtifacts ?? null,
        reviewQueue: dependencies.schoolLifecycle.stores.reviewQueue ?? null,
        allocationStore: dependencies.schoolLifecycle.stores.allocationStore ?? null,
        worksheetInstances: dependencies.schoolLifecycle.stores.worksheetInstances ?? null,
        curriculumExceptions: dependencies.schoolLifecycle.stores.curriculumExceptionStore ?? null,
        printDocuments: dependencies.schoolLifecycle.stores.printDocuments ?? null,
      }) : null,
    launchPreviewTokens: dependencies.schoolLaunchPreviewTokens,
    // Built inside the lifecycle module, where the companion code store and the
    // household id live — never re-constructed here over a second store
    // instance, which would be a second way to describe one file.
    getCompanionFinishCode: dependencies.schoolLifecycle.useCases?.getCompanionFinishCode ?? null,
    previewTeacherLessonMaterial: dependencies.schoolLifecycle.stores?.curriculum && dependencies.schoolLifecycle.stores?.printDocuments && dependencies.schoolLifecycle.renderPrintDocument
      ? new PreviewTeacherLessonMaterial({
        curriculum: dependencies.schoolLifecycle.stores.curriculum,
        printDocuments: dependencies.schoolLifecycle.stores.printDocuments,
        renderPrintDocument: dependencies.schoolLifecycle.renderPrintDocument,
      }) : null,
    getLearnerTimeline: dependencies.schoolLifecycle.stores?.sessions
      ? new GetLearnerTimeline({ sessions: dependencies.schoolLifecycle.stores.sessions, curriculum: dependencies.schoolLifecycle.stores.curriculum ?? null }) : null,
    // The very instance the child's shelf panel reads through (built in the
    // lifecycle module, over the one book log). Null in a composition without
    // the Books deps, which the teacher route answers as an honest 404.
    getBookShelf: dependencies.schoolLifecycle.useCases?.getBookShelf ?? null,
    // The teacher's reading workspace (design §3, §5). Built over the SAME
    // book log the child's panel writes through and the SAME notes path every
    // other teacher verb delivers on — there is no shadow teacher copy of a
    // child's shelf, and no second way to reach a child's feed.
    ...teacherReadingUseCases,
    adjustSessionGrade: dependencies.schoolLifecycle.stores?.sessions && schoolTeacherGate
      ? new AdjustSessionGrade({
        realtime: dependencies.schoolLifecycle.realtime,
        sessions: dependencies.schoolLifecycle.stores.sessions,
        teacherGate: schoolTeacherGate,
        passOverrides: dependencies.schoolLifecycle.passOverrides ?? null,
        worksheetInstances: dependencies.schoolLifecycle.stores.worksheetInstances ?? null,
        reviewQueue: dependencies.schoolLifecycle.stores.reviewQueue ?? null,
        curriculum: dependencies.schoolLifecycle.stores.curriculum ?? null,
        economy: economyApi.economyService,
        economyEnabled: schoolFullConfig.lifecycle?.economy?.enabled === true,
        receiptIssuer: dependencies.schoolLifecycle.useCases?.issueCorrectedResultReceipt ?? null,
        logger: rootLogger.child({ module: 'school-grade-adjustment' }),
      }) : null,
    retractSessionGradeAdjustment: dependencies.schoolLifecycle.stores?.sessions && schoolTeacherGate
      ? new RetractSessionGradeAdjustment({
        realtime: dependencies.schoolLifecycle.realtime,
        sessions: dependencies.schoolLifecycle.stores.sessions,
        teacherGate: schoolTeacherGate,
        curriculum: dependencies.schoolLifecycle.stores.curriculum ?? null,
        economy: economyApi.economyService,
        economyEnabled: schoolFullConfig.lifecycle?.economy?.enabled === true,
        receiptIssuer: dependencies.schoolLifecycle.useCases?.issueCorrectedResultReceipt ?? null,
        logger: rootLogger.child({ module: 'school-grade-adjustment' }),
      }) : null,
    invalidateSessionEvidence: dependencies.schoolLifecycle.useCases?.invalidateSessionEvidence ?? null,
    issuedArtifactStore: dependencies.schoolLifecycle.stores?.issuedArtifacts ?? null,
    renderIssuedArtifact: dependencies.schoolLifecycle.renderIssuedArtifact ?? null,
    teacherAgendaDispatch: dependencies.schoolLifecycle.useCases?.teacherAgendaDispatch ?? null,
    reprintIssuedArtifact: dependencies.schoolLifecycle.useCases?.reprintIssuedArtifact ?? null,
    reprintResultReceiptArtifact: dependencies.schoolLifecycle.useCases?.reprintResultReceiptArtifact ?? null,
    manageCurriculumException: dependencies.schoolLifecycle.useCases?.manageCurriculumException ?? null,
    manageProgramDayBypass: dependencies.schoolLifecycle.useCases?.manageProgramDayBypass ?? null,
    // What school work pays: the economy's earn rules, edited from the
    // teacher console behind the TeacherGate (reads: /api/v1/earnings).
    manageEarnRules: new ManageEarnRules({
      teacherGate: schoolTeacherGate,
      earnRules: economyApi.earnRulesService,
      learnerIds: async () => (await schoolLearnerDirectory.listLearners()).map((l) => l.id ?? l.learnerId).filter(Boolean),
      logger: rootLogger.child({ module: 'school-earn-rules' }),
    }),
    teacherCapabilitySessions,
    teacherGate: schoolTeacherGate,
    // Read per request, never snapshotted — clearing the PIN in school.yml
    // takes effect on the next config reload rather than the next restart.
    teacherPinRequired: () => {
      const pin = schoolTeacherConfig.pin();
      return typeof pin === 'string' && pin.length > 0;
    },
    openRemediation: dependencies.schoolLifecycle.useCases?.openRemediation ?? null,
    closeSessionOutcome: dependencies.schoolLifecycle.useCases?.closeSessionOutcome ?? null,
    renderArtifactPostview: createArtifactPostviewRenderer(),
    renderWorksheetThumbnail: renderPdfFirstPagePng,
    milestoneStore: schoolMilestoneStore,
    assignmentsStore: dependencies.schoolLifecycle.stores?.assignments ?? null,
    getLearnerRecord: new GetLearnerRecord({
      teacherNotes: schoolTeacherNotes,
      reviewQueue: dependencies.schoolLifecycle.stores?.reviewQueue ?? null,
      attestations: schoolAttestations,
      enrichment: schoolEnrichmentLog,
      quizRequests: () => schoolService.listQuizRequests(),
      printRequests: (learnerId) => schoolPrintService?.listRequestsFor?.(learnerId) ?? [],
      logger: rootLogger.child({ module: 'school-learner-record' }),
    }),
    schoolCalcRouter: dependencies.schoolCalc.router,
    surfaceCertification: schoolSurfaces.certification,
    surfaceRegistry: schoolSurfaces.registry,
    getScreenConfig: getSchoolScreenConfig,
    // The SAME render pipeline + repository the tracked-quiz path uses (spec
    // §9 shared-instance rule) — GET /print/:id renders through the identical
    // allocation store, so a freshCard render here is a real card allocation.
    renderPrintDocument: dependencies.schoolLifecycle.renderPrintDocument ?? null,
    printDocumentsRepo: dependencies.schoolLifecycle.stores?.printDocuments ?? null,
    printAllocationStore: dependencies.schoolLifecycle.stores?.allocationStore ?? null,
    // Teacher-key gate: answer keys deny until `print.teacherPin` is set in
    // the household school config and matched via `?pin=`.
    getPrintTeacherPin: () => {
      const schoolConfig = configService.getHouseholdAppConfig(null, 'school') || {};
      return schoolConfig.print?.teacherPin != null ? String(schoolConfig.print.teacherPin) : null;
    },
    // Report cards, period close, teacher digest (Task 6, spec R5b).
    getReportCard,
    closeAcademicPeriod,
    getTeacherToday,
    getTeachers,
    setAcademicPeriods,
    passOverrideStore: dependencies.schoolLifecycle.passOverrides ?? null,
    setPassOverride,
    milestoneStatuses,
    setMilestones,
    enrichmentLog: schoolEnrichmentLog,
    recordEnrichment,
    getProgressReport,
    renderProgressReportPdf: createProgressReportPdfRenderer(),
    renderCertificatePdf: createCertificatePdfRenderer(),
    getHouseholdOffsetMinutes: (nowMs) => schoolOffsetMinutesFor(configService.getTimezone?.() || null, nowMs),
    attestationLog: schoolAttestations,
    recordAttestation,
    teacherNotesStore: schoolTeacherNotes,
    recordTeacherNote,
    reassignEvidence,
    reassignSession,
    reassignmentLog: schoolReassignmentLog,
    attemptsStore: schoolDatastore,
    retractTeacherRecord,
    getTranscript,
    renderTranscriptPdf: createTranscriptPdfRenderer(),
    renderSyllabusPdf: createSyllabusPdfRenderer(),
    curriculumForSyllabus: dependencies.schoolLifecycle.stores?.curriculum ?? null,
    // Frozen-record reads work off `schoolDatastore` alone (no lifecycle
    // stores needed), so this is wired unconditionally.
    reportCardsStore: schoolDatastore,
    // Printable report card PDF (Task 7) — also wired unconditionally.
    renderReportCardPdf,
    // Feedback delivery + kid-visible standing (Task 9, spec R7 / adequacy
    // SHOULD 9) — the SAME review-queue store and academic-period source
    // `getReportCard` already reads above, reused rather than rebuilt.
    reviewQueue: dependencies.schoolLifecycle.stores?.reviewQueue ?? null,
    academicPeriods: schoolAcademicPeriods,
    logger: rootLogger.child({ module: 'school-api' })
  }));

  const { LanguageAudioResource } = await import("../application/LanguageAudioResource.mjs");
  const { FilesystemLanguageAudioRepository } = await import("../adapters/media/FilesystemLanguageAudioRepository.mjs");
  const languageAudioResource = new LanguageAudioResource({
    languageAudioRepository: new FilesystemLanguageAudioRepository({
      mediaDir: mediaBasePath,
      userExists: (userId) => Boolean(configService.getUserProfile(userId)),
    }),
    languageStudyService,
    // school.yml `sentence_ladder.cues.{role}: file` — files under media/school/_ux/.
    cues: configService.getHouseholdAppConfig(null, 'school')?.sentence_ladder?.cues || {},
  });
  const sentenceLadderRouter = createSentenceLadderRouter({ schoolErrors,
    languageStudyService,
    languageAudioResource,
    // The same instance the study service was given above — see there.
    languageTranscription,
    studyGrants: dependencies.schoolStudyGrants,
    logger: rootLogger.child({ module: 'school-language-api' })
  });
  v1Routers.school.use('/sentence-ladder', sentenceLadderRouter);
  // Compatibility alias for deployed clients and bookmarks. No removal in
  // this migration; legacy traffic is logged by the shared router.
  v1Routers.school.use('/language', sentenceLadderRouter);
  v1Routers.school.use('/language-reels', createLanguageReelsRouter({
    service: languageReelService, grants: dependencies.schoolReelGrants,
    logger: rootLogger.child({ module: 'school-language-reels-api' }),
  }));
  v1Routers.school.use('/rubiks-cube', createRubiksCubeRouter({
    service: rubiksCubeService, grants: dependencies.schoolCubeGrants, revision: RUBIKS_CUBE_REVISION,
    logger: rootLogger.child({ module: 'school-rubiks-cube-api' }),
  }));
  // Household-wide book resolution (`/api/v1/books/resolve`). `v1Routers` is
  // keyed by path segment, so a top-level router is a property, not a `.use`.
  v1Routers.books = createBooksApiRouter({
    resolveBook: books.resolveBook,
    resolveBookCover: books.resolveBookCover,
    logger: rootLogger.child({ module: 'books-api' }),
  });
  // The School reading shelf. Needs the lifecycle's shelf use cases (absent in
  // a composition without the Books domain deps) and a grant issuer.
  if (dependencies.schoolLifecycle.wired && dependencies.schoolBookGrants && dependencies.schoolLifecycle.useCases?.getBookShelf) {
    if (bookScans) v1Routers.school.use('/book-scans', createSchoolBookScansRouter({ bookScans, openAtPanel: openBookShelfAtPanel }));
    v1Routers.school.use('/books', createSchoolBooksRouter({
      grants: dependencies.schoolBookGrants,
      getBookShelf: dependencies.schoolLifecycle.useCases.getBookShelf,
      openBookShelfItem: dependencies.schoolLifecycle.useCases.openBookShelfItem,
      recordBookProgress: dependencies.schoolLifecycle.useCases.recordBookProgress,
      onBookLogChanged: (payload) => eventBus.broadcast('school', payload),
      // school.yml `books.manualEntry: false` makes the child's add door
      // scan-only; see BookEntryPolicy for why.
      entryPolicy: new BookEntryPolicy({
        manualEntryAllowed: () => configService.getHouseholdAppConfig(null, 'school')?.books?.manualEntry !== false,
        scanned: (args) => bookScans?.hasScanned(args) ?? false,
        logger: rootLogger.child({ module: 'school-books-api' }),
      }),
      logger: rootLogger.child({ module: 'school-books-api' }),
    }));
  }

  if (dependencies.schoolLifecycle.router) {
    v1Routers.school.use('/lifecycle', dependencies.schoolLifecycle.router);
  }
  // Only when the doubles were actually constructed (school.yml
  // `virtualDevices: true`). A production deployment never mounts a surface that
  // can knock a printer offline.
  if (dependencies.schoolLifecycle.devicesRouter) {
    v1Routers.school.use('/devices', dependencies.schoolLifecycle.devicesRouter);
  }
  // The school-room wall panel's keypad. Built inside the same
  // `lifecycle.enabled` gate as everything else above, so a locked panel
  // configured against a disabled lifecycle 404s here rather than answering
  // half a card.
  if (dependencies.schoolLifecycle.selfServiceRouter) {
    v1Routers.school.use('/self-service', dependencies.schoolLifecycle.selfServiceRouter);
  }
  return { schoolStateGatesProducer, bookScans, schoolPrintService, schoolTeacherNotes };
}
