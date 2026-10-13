/** Existing school catalog runtime assembly; preserves construction order. */
import { createSchoolCatalog as createSchoolCatalog } from "./schoolCatalog.mjs";
import { YamlAssignmentStore as YamlAssignmentStore } from "../adapters/persistence/YamlAssignmentStore.mjs";
import { shortId as shortId } from "#system/utils/id.mjs";
import path from "path";
import { studentDisplayName as studentDisplayName } from "./studentNames.mjs";
import { OpenCatalogLearningSession as OpenCatalogLearningSession } from "../application/OpenCatalogLearningSession.mjs";
import { OfferCatalogQuizRemediation as OfferCatalogQuizRemediation } from "../application/remediation/OfferCatalogQuizRemediation.mjs";
import { IssueSchoolContinuationCode as IssueSchoolContinuationCode } from "../application/IssueSchoolContinuationCode.mjs";
import { createSchoolSurfaces as createSchoolSurfaces } from "./schoolSurfaces.mjs";
import { YamlSchoolScreenConfigSource as YamlSchoolScreenConfigSource } from "../adapters/YamlSchoolScreenConfigSource.mjs";
import { createSchoolCalc as createSchoolCalc } from "./schoolCalc.mjs";
import { PlexSchoolMediaCatalog as PlexSchoolMediaCatalog } from "../adapters/media/plex/PlexSchoolMediaCatalog.mjs";
import { MediaAlbumSource as MediaAlbumSource } from "../application/sources/MediaAlbumSource.mjs";
import { MediaSeriesSource as MediaSeriesSource } from "../application/sources/MediaSeriesSource.mjs";
import { MediaLabelSource as MediaLabelSource } from "../application/sources/MediaLabelSource.mjs";
import { GetMaterialCatalog as GetMaterialCatalog } from "../application/GetMaterialCatalog.mjs";
import { buildBankIndex as buildBankIndex } from "../application/GetMaterialUnits.mjs";
import { GetMaterialUnits as GetMaterialUnits } from "../application/GetMaterialUnits.mjs";
import { effectiveAttempts as effectiveAttempts } from "../domain/attempt.mjs";
import { GetMaterialProgressSummary as GetMaterialProgressSummary } from "../application/GetMaterialProgressSummary.mjs";

export async function createSchoolCatalogRuntime(dependencies) {
  const { configService, householdId, schoolLearnerDirectory, exerciseLibrary, rootLogger, schoolService, schoolTeacherGate, schoolFullConfig, dataDir, scopedGateway, schoolDatastore, agentUsageRecorder, notificationStack, server, enableScheduler, schoolLearningLoop, householdDir, getLearningProgress, schoolLearningEvidence, SchoolUserVideoProgressStore, contentRegistry, NodeAsyncScheduler } = dependencies;
const schoolCatalog = createSchoolCatalog({
    configService,
    householdId,
    learnerDirectory: schoolLearnerDirectory,
    exerciseLibrary,
    logger: rootLogger.child({ module: 'school-catalog' }),
  });
  const { YamlFlashcardProgressStore } = await import("../adapters/persistence/YamlFlashcardProgressStore.mjs");
  const { SchoolFlashcardAssetRepository } = await import("../adapters/catalog/SchoolFlashcardAssetRepository.mjs");
  const { TsFsrsFlashcardScheduler } = await import("../adapters/flashcards/TsFsrsFlashcardScheduler.mjs");
  const { FlashcardStudyService } = await import("../application/FlashcardStudyService.mjs");
  const { FlashcardSchedulerPolicyResolver } = await import("../application/FlashcardSchedulerPolicyResolver.mjs");
  const { ConfigFlashcardSchedulerPolicySource } = await import("../adapters/flashcards/ConfigFlashcardSchedulerPolicySource.mjs");
  const flashcardAssignments = new YamlAssignmentStore({ configService, logger: rootLogger.child({ module: 'school-flashcard-assignments' }) });
  const flashcardStudy = schoolCatalog.content
    ? new FlashcardStudyService({
      progressStore: new YamlFlashcardProgressStore({ configService, logger: rootLogger.child({ module: 'school-flashcards' }) }),
      decks: schoolCatalog.content,
      assignments: flashcardAssignments,
      grader: schoolService,
      scheduler: new TsFsrsFlashcardScheduler(),
      policyResolver: new FlashcardSchedulerPolicyResolver({
        policySource: new ConfigFlashcardSchedulerPolicySource({ configService }),
        assignments: flashcardAssignments,
        catalog: schoolCatalog.query,
      }),
      teacherGate: schoolTeacherGate,
      timezone: configService.getTimezone?.() || null,
      now: Date.now,
      id: shortId,
    })
    : null;
  // `media:` ids (generated word packages) resolve under <mediaDir>/school.
  const schoolMediaRoot = path.join(configService.getMediaDir(), 'school');
  const flashcardAssets = new SchoolFlashcardAssetRepository({
    rootDir: schoolFullConfig.flashcards?.assets?.dir ?? path.join(dataDir, 'content', 'assets'),
    mediaRootDir: schoolMediaRoot,
  });
  // Card ladder v3 (mastery redesign rev 4). Two services over one engine:
  // live on the real store, and test mode (`/card-ladder/test`) on in-memory
  // shadow copies that can never reach disk (spec §8).
  const { CardLadderSittingService } = await import("../application/CardLadderSittingService.mjs");
  const { CardLadderTypedJudge } = await import("../application/CardLadderTypedJudge.mjs");
  const { YamlCardLadderStore } = await import("../adapters/cardLadder/YamlCardLadderStore.mjs");
  const { YamlJudgementCache, MemoryJudgementCache } = await import("../adapters/cardLadder/YamlJudgementCache.mjs");
  const { ShadowCardLadderStores } = await import("../adapters/cardLadder/ShadowCardLadderStores.mjs");
  const { FilesystemCardLadderRecordings } = await import("../adapters/cardLadder/FilesystemCardLadderRecordings.mjs");
  const { DiscardingRecordings } = await import("../adapters/cardLadder/DiscardingRecordings.mjs");
  const { YamlLexiconRepository } = await import("../adapters/catalog/YamlLexiconRepository.mjs");
  const { resolveSettings, seedScenario, cardLadderConfigOf } = await import("../domain/cardLadder/index.mjs");
  const cardLadderLogger = rootLogger.child({ module: 'school-card-ladder' });
  // `card_ladder` in school.yml; the pre-rename `word_ladder` key is read when it is absent.
  const cardLadderConfig = cardLadderConfigOf(schoolFullConfig);
  const cardLadderSettings = () => resolveSettings(cardLadderConfig);
  const cardLadderStore = new YamlCardLadderStore({ configService, logger: cardLadderLogger });
  const cardLadderLexicons = new YamlLexiconRepository({ mediaRoot: schoolMediaRoot });
  const cardLadderJudgeFor = (cache) => new CardLadderTypedJudge({
    aiGateway: scopedGateway(dependencies.sharedAiGateway, { app: 'school', feature: 'card-ladder' }),
    decisionGateway: scopedGateway(dependencies.decisionGateway, { app: 'school', feature: 'card-ladder' }),
    cache, model: cardLadderConfig.judge?.model ?? null,
    passScore: cardLadderSettings().typing.passScore, logger: cardLadderLogger,
  });
  const cardLadderShared = {
    decks: schoolCatalog.content, lexicons: cardLadderLexicons, assignments: flashcardAssignments,
    attempts: schoolDatastore, assets: flashcardAssets, teacherGate: schoolTeacherGate,
    settings: cardLadderSettings, bounds: cardLadderConfig.bounds ?? null, timezone: configService.getTimezone?.() || null, now: Date.now,
    logger: cardLadderLogger,
  };
  // One cache for the live judge and the grown-up re-grade that overwrites it (spec §6).
  // `runtime/card-ladder`; a package's judgements still under the pre-rename
  // `runtime/word-ladder` are copied over on first use (never moved).
  const cardLadderJudgementCache = new YamlJudgementCache({
    rootDir: path.join(dataDir, 'household', 'school', 'runtime', 'card-ladder'),
    legacyRootDir: path.join(dataDir, 'household', 'school', 'runtime', 'word-ladder'),
  });
  const cardLadderStudy = schoolCatalog.content ? new CardLadderSittingService({
    ...cardLadderShared, mode: 'live', judgementCache: cardLadderJudgementCache,
    stores: {
      open: () => ({ store: cardLadderStore, token: 'live' }),
      forToken: (token) => { if (token !== 'live') throw new Error('unknown sitting'); return cardLadderStore; },
      // The start card's read (`intro`): the real store's read-only view, which
      // never writes — not even the one-time move of a pre-rename package.
      peek: () => cardLadderStore.readOnlyView(),
    },
    judge: cardLadderJudgeFor(cardLadderJudgementCache),
    // Spoken takes, kept for grown-ups: {package}/{learner}/{day}/{word}-{n}.{ext}.
    // (The pre-rename `recordings/word-ladder` is copied over per learner on first use.)
    recordings: new FilesystemCardLadderRecordings({
      rootDir: path.join(schoolMediaRoot, 'recordings', 'card-ladder'),
      legacyRootDir: path.join(schoolMediaRoot, 'recordings', 'word-ladder'),
    }),
  }) : null;
  const cardLadderShadows = new ShadowCardLadderStores({ real: cardLadderStore });
  // Test mode never writes attempts or takes, and cannot fold (no teacher gate).
  const cardLadderTest = schoolCatalog.content ? new CardLadderSittingService({
    ...cardLadderShared, mode: 'test', attempts: null, teacherGate: null, recordings: new DiscardingRecordings(),
    stores: {
      open: (userId, pkg, day, { scenario = null, deck = null } = {}) => {
        const token = cardLadderShadows.create(userId, pkg, day,
          (snap) => seedScenario(scenario ?? 'today', snap, { deckWords: deck?.words ?? [], day }));
        return { store: cardLadderShadows.forToken(token), token };
      },
      forToken: (token) => cardLadderShadows.forToken(token),
      // The start card reads what Start would open on — seeded, never kept.
      peek: (userId, pkg, day, { scenario = null, deck = null } = {}) => cardLadderShadows.peek(userId, pkg, day,
        (snap) => seedScenario(scenario ?? 'today', snap, { deckWords: deck?.words ?? [], day })),
    },
    // Reads through to the live cache (a grown-up's re-grade applies here too); writes stay in memory.
    judge: cardLadderJudgeFor(new MemoryJudgementCache({ fallback: cardLadderJudgementCache })),
  }) : null;
  // The tuning pass (spec §7): on the REAL store only, the tuner agent only
  // when `card_ladder.tuner.model` is set, a concern pushed to the teachers.
  // Ticks every 15 min wherever the agent scheduler runs; the service itself
  // waits for the study day to end.
  let cardLadderTuning = null;
  if (schoolCatalog.content) {
    try {
      const { createCardLadderTuning } = await import("./cardLadderTuning.mjs");
      const { agentSchedulerEnabled } = await import("../../../../../__capabilities/agent-runtime/server/composition/agentSchedulerEnabled.mjs");
      const { isContainerRuntime } = await import('#system/runtime/runtimeEnvironment.mjs');
      const tuningNames = studentDisplayName(configService);
      cardLadderTuning = createCardLadderTuning({
        store: cardLadderStore, assignments: flashcardAssignments, decks: schoolCatalog.content, lexicons: cardLadderLexicons,
        settings: cardLadderSettings, bounds: cardLadderConfig.bounds ?? null, teacherGate: schoolTeacherGate,
        timezone: configService.getTimezone?.() || null, now: Date.now,
        model: cardLadderConfig.tuner?.model ?? null, mediaDir: configService.getMediaDir(), usageRecorder: agentUsageRecorder,
        notificationService: notificationStack?.notificationService ?? null,
        teachers: () => (configService.getHouseholdAppConfig(null, 'school') || {}).teachers ?? [],
        learnerName: (id) => tuningNames(id),
        logger: cardLadderLogger, server,
        scheduled: enableScheduler && agentSchedulerEnabled({
          nodeEnv: process.env.NODE_ENV, enableCron: process.env.ENABLE_CRON, isContainer: isContainerRuntime(),
        }),
      });
    } catch (error) {
      cardLadderLogger.error('school.card-ladder.tuning-unavailable', { error: error.message });
    }
  }
  const openCatalogLearningSession = schoolCatalog.query
    ? new OpenCatalogLearningSession({ catalog: schoolCatalog.query, grader: schoolService })
    : null;
  const offerCatalogQuizRemediation = schoolCatalog.query
    ? new OfferCatalogQuizRemediation({
      catalog: schoolCatalog.query,
      grader: schoolService,
      remediationOffers: schoolLearningLoop.offers,
    })
    : null;
  // Six-digit codes have to remain valid after ordinary roster edits.  Their
  // explicitly configured slots are therefore a School-wide publication
  // policy, never a device-discovered or array-order-derived implementation
  // detail.
  const continuationSlots = schoolFullConfig.schoolcalc?.continuation?.learner_slots;
  let issueContinuationCode = null;
  try {
    issueContinuationCode = new IssueSchoolContinuationCode({
      learners: schoolLearnerDirectory, learnerSlots: continuationSlots,
    });
  } catch (error) {
    rootLogger.child({ module: 'school-continuation' }).warn?.('school.continuation.unwired', { error: error.message });
  }

  // Surface certification (spec §4.2/§7.1/§9): the registry of static
  // surface profiles + per-family certification ports, and a per-request
  // certification facade for `/api/v1/school/certification` and
  // `/api/v1/school/surfaces/profile`. Inert (both null) whenever the shared
  // School Catalog itself is not wired — certification has nothing to
  // certify without it.
  const schoolSurfaces = await createSchoolSurfaces({
    schoolCatalog,
    // Profiles live under `household/school/surfaces` — render policy, not
    // curriculum, so deliberately NOT under the catalog's contentRoot.
    dataDir: configService.getDataDir(),
    logger: rootLogger.child({ module: 'school-surfaces' }),
  });
  // Screen-config lookup for surface-profile resolution, reusing the same
  // `data/household/screens/<id>.yml` mount `screens.mjs` serves —
  // `loadYamlFromPath` returns null on a missing/unparsable file rather than
  // throwing, which is exactly the "no config" case the resolver treats as a
  // 404 (fail closed, never a synthesized default).
  const getSchoolScreenConfig = new YamlSchoolScreenConfigSource({ householdDirectory: householdDir }).get;
  // Optional calculator-native School product. The composition module is the
  // only place that joins calculator-family adapters, SchoolCalc application
  // use cases, persistence, relay credentials, and the thin HTTP router.
  const schoolCalcLogger = rootLogger.child({ module: 'schoolcalc' });
  let schoolCalc = {
    wired: false, reason: 'not attempted', container: null, router: null, resultImporter: null,
  };
  try {
    schoolCalc = createSchoolCalc({
      configService,
      schoolService,
      learnerDirectory: schoolLearnerDirectory,
      learningProgress: getLearningProgress,
      remediationOffers: schoolLearningLoop.offers,
      remediationTutor: schoolLearningLoop.tutor,
      probeEvidenceRepository: schoolLearningEvidence,
      schoolCatalog,
      householdId,
      logger: schoolCalcLogger,
    });
  } catch (err) {
    // SchoolCalc is explicitly opt-in. A bad calculator content mount or relay
    // credential disables that surface without taking down the rest of School.
    schoolCalcLogger.error('schoolcalc.wiring-failed', { error: err.message });
  }
  // Dumb playhead/percent/duration store only (spec §6) — School never reads
  // its threshold/engaged/completedAt fields, unlike Piano's own instance.
  const schoolMaterialProgressStore = new SchoolUserVideoProgressStore({
    configService,
    app: 'school',
    filename: 'material-progress',
    logger: rootLogger.child({ module: 'school-materials' })
  });

  const schoolMaterialsConfig = configService.getHouseholdAppConfig(null, 'school')?.materials || null;
  let getMaterialCatalog = null;
  let getMaterialUnits = null;
  let getMaterialProgressSummary = null;
  if (schoolMaterialsConfig) {
    // School sees one neutral media catalog. Provider metadata translation is
    // isolated here in the adapter and can later be swapped for Jellyfin.
    const schoolMediaCatalog = new PlexSchoolMediaCatalog({
      plexAdapter: contentRegistry?.get('plex') || null
    });
    const mediaAlbumSource = new MediaAlbumSource({ mediaCatalog: schoolMediaCatalog, logger: rootLogger.child({ module: 'school-materials' }) });
    const mediaSeriesSource = new MediaSeriesSource({ mediaCatalog: schoolMediaCatalog });
    const schoolMaterialSources = {
      'media-album': mediaAlbumSource,
      'media-series': mediaSeriesSource,
      'media-label': new MediaLabelSource({
        mediaCatalog: schoolMediaCatalog,
        videoSource: mediaSeriesSource,
        audioSource: mediaAlbumSource
      })
    };
    getMaterialCatalog = new GetMaterialCatalog({
      sources: schoolMaterialSources,
      config: schoolMaterialsConfig,
      scheduler: new NodeAsyncScheduler(),
      logger: rootLogger.child({ module: 'school-materials' })
    });
    // Pre-warm the catalog in the background at boot so the first subject-open
    // after a (cache-clearing) redeploy hits a warm cache instead of paying the
    // full Plex fan-out. Fire-and-forget — never blocks startup, and a failure
    // just means the first real request rebuilds it.
    getMaterialCatalog.execute()
      .then((c) => rootLogger.child({ module: 'school-materials' }).info?.('school.materials.prewarmed', { count: c?.materials?.length ?? 0 }))
      .catch((err) => rootLogger.child({ module: 'school-materials' }).warn?.('school.materials.prewarm-failed', { error: err.message }));
    // Pre-warm the bank summaries too (the 4600-file scan), ASYNC so it never
    // blocks boot/the event loop, and keep them warm on a background interval so
    // a home load / gating lookup always hits the cache instead of a cold scan.
    // `elapsedMs` is the point of this log, not `count`. This scan blocked the
    // event loop ~7.8s every 4 minutes until 2026-09-02 (O(N^2) sync YAML in
    // readAllBankRaws), which is what made the fitness wall read 0 RPM on a
    // schedule. The count cannot show that; the duration can, and it is the
    // only direct check that the fix is still holding.
    // See __docs/_wip/bugs/2026-09-02-fitness-rpm-false-zeros-pause-video-during-cycle-challenge.md
    const warmSchoolBanks = () => {
      const startedAt = Date.now();
      return schoolService.warmBanks({ force: true })
        .then((list) => rootLogger.child({ module: 'school-materials' }).info?.('school.banks.prewarmed', {
          count: list.length, elapsedMs: Date.now() - startedAt,
        }))
        .catch((err) => rootLogger.child({ module: 'school-materials' }).warn?.('school.banks.prewarm-failed', {
          error: err.message, elapsedMs: Date.now() - startedAt,
        }));
    };
    warmSchoolBanks();
    setInterval(warmSchoolBanks, 4 * 60 * 1000).unref(); // force a refresh before the 5-min TTL lapses, so requests always hit a warm cache
    // Rebuilt from schoolService.listBanks() (cheap YAML-directory read, no
    // cache of its own) on every lookup rather than once at boot, so a newly
    // authored gating bank takes effect without a restart — matching
    // listBanks()'s own no-cache behaviour.
    // `opts.trackParents` (Map<trackId, unitId>, from the material fetch)
    // rolls chapter-level bank backlinks up to the unit they gate (Blocker 2).
    const schoolMaterialBankIndex = { byUnit: (unitId, opts) => buildBankIndex(schoolService.listBanks(), opts).byUnit(unitId) };
    // Disk snapshot of the compiled material index: seeds the units cache at
    // boot so a redeploy serves in ~0.5s from day-old data (refreshed in the
    // background) instead of re-paying the serialized Plex sweep cold.
    const { YamlMaterialSnapshotStore } = await import("../adapters/persistence/YamlMaterialSnapshotStore.mjs");
    getMaterialUnits = new GetMaterialUnits({
      catalog: getMaterialCatalog,
      sources: schoolMaterialSources,
      config: schoolMaterialsConfig,
      progressStore: schoolMaterialProgressStore,
      bankIndex: schoolMaterialBankIndex,
      attemptsReader: { read: (userId) => effectiveAttempts(schoolDatastore.readAllAttempts(userId)) },
      scheduler: new NodeAsyncScheduler(),
      logger: rootLogger.child({ module: 'school-materials' }),
      snapshot: new YamlMaterialSnapshotStore({ configService, logger: rootLogger.child({ module: 'school-materials' }) })
    });
    getMaterialProgressSummary = new GetMaterialProgressSummary({
      catalog: getMaterialCatalog,
      getMaterialUnits,
      progressStore: schoolMaterialProgressStore,
      logger: rootLogger.child({ module: 'school-materials' })
    });
  }
  return { schoolCatalog, flashcardStudy, flashcardAssets, cardLadderConfig, cardLadderStudy, cardLadderTest, cardLadderTuning, openCatalogLearningSession, offerCatalogQuizRemediation, issueContinuationCode, schoolSurfaces, getSchoolScreenConfig, schoolCalc, schoolMaterialProgressStore, getMaterialCatalog, getMaterialUnits, getMaterialProgressSummary };
}
