import {join} from "node:path";
import { createPianoRouter } from "./api/piano.mjs";
import { PianoContainer } from "./application/PianoContainer.mjs";
import { PianoGameBudgetService } from "./application/PianoGameBudgetService.mjs";
import { PianoChallengeProfileService } from "./application/PianoChallengeProfileService.mjs";
import { SchoolPianoChallengeCompletionService } from "./application/SchoolPianoChallengeCompletionService.mjs";
import { YamlPianoStudioDatastore } from "./adapters/YamlPianoStudioDatastore.mjs";
import { YamlPianoAttemptStore } from "./adapters/persistence/YamlPianoAttemptStore.mjs";
import { YamlPianoLearningStore } from "./adapters/persistence/YamlPianoLearningStore.mjs";
import { YamlExerciseBank } from "./adapters/YamlExerciseBank.mjs";
import { PianoScaleChallengePolicy } from "./application/PianoScaleChallengePolicy.mjs";
import { BankChallengePolicy } from "./application/BankChallengePolicy.mjs";
import { PianoLearningService } from "./application/PianoLearningService.mjs";

/** Installed Piano assembly; callers supply cross-product contracts explicitly. */
export async function createPianoModule({configService, userService, rootLogger, contentRegistry, householdId, contentPath, fitnessPlayableService, contentServices, getCurriculumIndex, mergeSeason, eventBus, shortId, pianoBoardGameDayService, schoolLearnerDirectory, ComposerSongStore, YamlAssignmentStore, PianoConfigProjection, YamlPianoGameBudgetStore}) {
  const pianoStudioDatastore = new YamlPianoStudioDatastore({
    configService,
    userService,
    logger: rootLogger.child({ module: 'piano-datastore' })
  });
  const composerSongStore = new ComposerSongStore({
    configService,
    logger: rootLogger.child({ module: 'composer-store' })
  });
  // Minimal Plex children seam for the piano activity strip (collection →
  // shows). Same contract as schoolPlexClient.children below: thumbs come
  // back app-proxied.
  const pianoPlexAdapter = contentRegistry?.get('plex') || null;
  const pianoPlexClient = pianoPlexAdapter ? {
    children: async (ratingKey) => {
      if (!pianoPlexAdapter?.client) return [];
      // Collections MUST list via /library/collections/{id}/items — the
      // generic /children endpoint returns WRONG contents for some
      // collections (observed live: 675686's "children" were another
      // collection's shows, doubling six courses and dropping two).
      const data = await pianoPlexAdapter.client.getContainer(`/library/collections/${ratingKey}/items`);
      const items = data?.MediaContainer?.Metadata || [];
      const proxyPath = pianoPlexAdapter.proxyPath;
      return items.map((item) => {
        const rewritten = { ...item };
        if (typeof rewritten.thumb === 'string' && rewritten.thumb.startsWith('/')) {
          rewritten.thumb = `${proxyPath}${rewritten.thumb}`;
        }
        return rewritten;
      });
    },
    // One item's own metadata — for lesson shows that live in NO collection
    // (config `shows:` entries). Same thumb proxy-rewrite contract.
    metadata: async (ratingKey) => {
      if (!pianoPlexAdapter?.client) return null;
      const data = await pianoPlexAdapter.client.getContainer(`/library/metadata/${ratingKey}`);
      const item = data?.MediaContainer?.Metadata?.[0];
      if (!item) return null;
      const rewritten = { ...item };
      const proxyPath = pianoPlexAdapter.proxyPath;
      if (typeof rewritten.thumb === 'string' && rewritten.thumb.startsWith('/')) {
        rewritten.thumb = `${proxyPath}${rewritten.thumb}`;
      }
      return rewritten;
    },
  } : null;
  // Piano program assignments are edited from the existing Teacher console, so
  // they use that console's one authorization predicate rather than inventing a
  // second grown-up/PIN interpretation in the piano bounded context.
  const { makeTeacherGate } = await import("#apps/school/TeacherGate.mjs");
  const { SchoolTeacherConfigSource } = await import("#adapters/school/SchoolTeacherConfigSource.mjs");
  const schoolTeacherConfig = new SchoolTeacherConfigSource({ configService });
  const schoolTeacherGate = makeTeacherGate({
    loadTeachers: schoolTeacherConfig.teachers,
    loadTeacherPin: schoolTeacherConfig.pin,
    userService,
    householdId,
    logger: rootLogger.child({ module: 'school-teacher-gate' }),
  });
  const pianoAttemptStore = new YamlPianoAttemptStore({
    usersDir: join(configService.getDataDir(), 'users'),
  });
  // Exercise bank: seeds at data/content/music/, instances computed on demand.
  const exerciseBank = new YamlExerciseBank({ contentDir: contentPath });
  const pianoLearningStore = new YamlPianoLearningStore({
    usersDir: join(configService.getDataDir(), 'users'),
    assignmentsDir: configService.getHouseholdPath('piano/program-assignments'),
  });
  const pianoLearningService = new PianoLearningService({
    exerciseBank,
    attemptStore: pianoAttemptStore,
    learningStore: pianoLearningStore,
    studioDatastore: pianoStudioDatastore,
    teacherGate: schoolTeacherGate,
    logger: rootLogger.child({ module: 'piano-learning' }),
  });
  // School's learner assignments, read by Piano's `GetPlayableUnits` for one
  // decision only: whether a co-progress lockout is standing in front of the
  // lesson School assigned today, which pacing must never block. Its own
  // instance for the same reason `flashcardAssignments` has one — the store is
  // a stateless reader of parent-editable YAML, and School's lifecycle is built
  // later in this file (it consumes the piano use case, so piano cannot wait
  // on it).
  const pianoSchoolAssignments = new YamlAssignmentStore({
    configService, logger: rootLogger.child({ module: 'piano-school-assignments' }),
  });
  const pianoContainer = new PianoContainer({
    // D1: the use case receives the Plex curriculum reader, never imports it.
    curriculumIndex: { getCurriculumIndex, mergeSeason },
    schoolAssignments: pianoSchoolAssignments,
    studioDatastore: pianoStudioDatastore,
    fitnessPlayableService,
    userVideoProgressStore: contentServices.userVideoProgressStore,
    composerSongStore,
    configProjection: new PianoConfigProjection({ configService }),
    plexClient: pianoPlexClient,
    learningService: pianoLearningService,
    logger: rootLogger.child({ module: 'piano-api' })
  });
  // Game-time budget (design 2026-08-27): layer-2 YAML store (a balance, not
  // a ledger — see the store's header) behind the pure orchestration service.
  // Both get a real child logger here so budget.opened/settled/depleted/
  // config-invalid events actually reach the log store — until wired they
  // silently defaulted to console.
  //
  // historyRoot goes through configService.getHouseholdPath, NOT a hardcoded
  // `path.join(dataDir, 'household/...')` — the comment above (household
  // domain-path resolution, ~line 744) exists specifically to keep storage
  // layout (household vs household-{hid}) out of the application layer.
  // Identical output today (single-household); wrong the moment a second
  // household exists.
  const pianoGameBudgetStore = new YamlPianoGameBudgetStore({
    historyRoot: configService.getHouseholdPath('history/piano-games', householdId),
    logger: rootLogger.child({ component: 'piano-game-budget' }),
  });
  const pianoGameBudgetService = new PianoGameBudgetService({
    store: pianoGameBudgetStore,
    config: () => configService.getHouseholdAppConfig(null, 'piano')?.gameLimit,
    // Same accessor School's own composition uses (schoolLifecycle.mjs) —
    // NOT getHouseholdAppConfig(null,'school')?.timezone. A wrong timezone
    // here silently moves the 4am study-day boundary (D6).
    timezone: configService.getTimezone?.() || null,
    logger: rootLogger.child({ component: 'piano-game-budget' }),
  });
  const pianoChallengeProfileService = new PianoChallengeProfileService({
    datastore: pianoStudioDatastore,
  });
  const schoolPianoChallengeCompletionService = new SchoolPianoChallengeCompletionService({
    datastore: pianoStudioDatastore,
    config: () => configService.getHouseholdAppConfig(null, 'piano')?.pianoChallenge ?? {},
    timezone: configService.getTimezone?.() || null,
  });
  const router = createPianoRouter({
    pianoContainer,
    // LATE-BOUND on purpose. `schoolLearnerDirectory` is constructed a little
    // below this line (School is wired after Piano), and the roster route only
    // calls this on a request, long after both exist. A forward reference in a
    // thunk keeps the two subsystems in their current order instead of
    // reshuffling the composition root around one field.
    schoolLearnerDirectory: { listLearners: () => schoolLearnerDirectory.listLearners() },
    pianoAttemptStore,
    pianoLearningService,
    pianoGameBudgetService,
    pianoBoardGameDayService,
    pianoChallengeProfileService,
    schoolPianoChallengeCompletionService,
    eventBus,
    idFactory: shortId,
    producerRecords: await import('./application/producerRecords.mjs'),
    pianoChallengePolicy: exerciseBank.available()
      ? new BankChallengePolicy({ exerciseBank, attemptStore: pianoAttemptStore })
      : new PianoScaleChallengePolicy({ attemptStore: pianoAttemptStore }),
    exerciseBank,
    logger: rootLogger.child({ module: 'piano-api' })
  });

  return {router, pianoStudioDatastore, composerSongStore, pianoContainer, pianoGameBudgetService, pianoChallengeProfileService, schoolPianoChallengeCompletionService, schoolTeacherConfig, schoolTeacherGate};
}
