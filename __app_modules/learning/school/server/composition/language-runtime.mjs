/** Existing school language runtime assembly; preserves construction order. */
import { YamlAssignmentStore as YamlAssignmentStore } from "../adapters/persistence/YamlAssignmentStore.mjs";
import { HmacSchoolStudyGrantIssuer as HmacSchoolStudyGrantIssuer } from "../adapters/actions/HmacSchoolStudyGrantIssuer.mjs";
import { HmacSchoolReelGrantIssuer as HmacSchoolReelGrantIssuer } from "../adapters/actions/HmacSchoolReelGrantIssuer.mjs";
import { HmacSchoolCubeGrantIssuer as HmacSchoolCubeGrantIssuer } from "../adapters/actions/HmacSchoolCubeGrantIssuer.mjs";
import { HmacSchoolBookGrantIssuer as HmacSchoolBookGrantIssuer } from "../adapters/actions/HmacSchoolBookGrantIssuer.mjs";
import { HmacSchoolLaunchPreviewTokenIssuer as HmacSchoolLaunchPreviewTokenIssuer } from "../adapters/actions/HmacSchoolLaunchPreviewTokenIssuer.mjs";
import { HmacSchoolDebriefGrantIssuer as HmacSchoolDebriefGrantIssuer } from "../adapters/actions/HmacSchoolDebriefGrantIssuer.mjs";
import { YamlDocumentFileStore as YamlDocumentFileStore } from "../adapters/YamlDocumentFileStore.mjs";
import { LanguageReelService as LanguageReelService } from "../application/LanguageReelService.mjs";
import { FilesystemLanguageReelRepository as FilesystemLanguageReelRepository } from "../adapters/FilesystemLanguageReelRepository.mjs";
import crypto from "node:crypto";
import { KociembaCubeRecoverySolver as KociembaCubeRecoverySolver } from "../adapters/rubiksCube/KociembaCubeRecoverySolver.mjs";
import { RubiksCubeCourseService as RubiksCubeCourseService } from "../application/rubiksCube/RubiksCubeCourseService.mjs";
import { FilesystemRubiksCubeProgressRepository as FilesystemRubiksCubeProgressRepository } from "../adapters/FilesystemRubiksCubeProgressRepository.mjs";
import { RUBIKS_CUBE_COURSE_ID as RUBIKS_CUBE_COURSE_ID } from "../application/rubiksCube/courseCatalog.mjs";
import { RubiksPacketPlanner as RubiksPacketPlanner } from "../application/rubiksCube/RubiksPacketPlanner.mjs";
import { createLanguageStudyService as createLanguageStudyService } from "./schoolLanguage.mjs";
import { YamlLanguageStudyDatastore as YamlLanguageStudyDatastore } from "../adapters/persistence/YamlLanguageStudyDatastore.mjs";
import { resolveGate as resolveGate } from "../domain/accessGate.mjs";

export async function createSchoolLanguageRuntime(dependencies) {
  const { configService, rootLogger, jwtSecret, PANEL_BOOK_GRANT_TTL_MS, createLanguageTranscriptionService, scopedGateway, schoolFullConfig, eventBus, presenceStore } = dependencies;
const readGateConfig = () => configService.getHouseholdAppConfig(null, 'school')?.gate || null;
  const languageAssignments = new YamlAssignmentStore({ configService, logger: rootLogger });
  let schoolStudyGrants = null;
  let schoolReelGrants = null;
  let schoolCubeGrants = null;
  let schoolBookGrants = null;
  let schoolBookPanelGrants = null;
  let schoolLaunchPreviewTokens = null;
  let schoolDebriefGrants = null;
  try {
    schoolStudyGrants = new HmacSchoolStudyGrantIssuer({ key: jwtSecret });
  } catch (error) {
    rootLogger.error('school.sentence-ladder.study-grants-unavailable', { error: error.message });
  }
  try { schoolReelGrants = new HmacSchoolReelGrantIssuer({ key: jwtSecret }); } catch (error) {
    rootLogger.error('school.language-reels.grants-unavailable', { error: error.message });
  }
  try { schoolCubeGrants = new HmacSchoolCubeGrantIssuer({ key: jwtSecret }); } catch (error) {
    rootLogger.error('school.rubiks-cube.grants-unavailable', { error: error.message });
  }
  try { schoolBookGrants = new HmacSchoolBookGrantIssuer({ key: jwtSecret }); } catch (error) {
    rootLogger.error('school.books.grants-unavailable', { error: error.message });
  }
  // The panel door's own issuer. Same key context and same `verify`, so the
  // shelf routes are untouched — only the clock differs. The default eight
  // hours is priced for a printed code capped at twelve uses; a face tap on a
  // shared wall panel proves nothing like that much, so it buys minutes.
  try {
    schoolBookPanelGrants = new HmacSchoolBookGrantIssuer({ key: jwtSecret, ttlMs: PANEL_BOOK_GRANT_TTL_MS });
  } catch (error) {
    rootLogger.error('school.books.panel-grants-unavailable', { error: error.message });
  }
  try { schoolLaunchPreviewTokens = new HmacSchoolLaunchPreviewTokenIssuer({ key: jwtSecret }); } catch (error) {
    rootLogger.error('school.launch-preview.tokens-unavailable', { error: error.message });
  }
  try { schoolDebriefGrants = new HmacSchoolDebriefGrantIssuer({ key: jwtSecret }); } catch (error) {
    rootLogger.error('school.debrief.grants-unavailable', { error: error.message });
  }
  const schoolDocumentFileStore = new YamlDocumentFileStore();
  const languageReelService = new LanguageReelService({
    repository: new FilesystemLanguageReelRepository({
      configService,
      store: schoolDocumentFileStore,
    }),
    idFactory: crypto.randomUUID,
  });
  const rubiksRecoverySolver = new KociembaCubeRecoverySolver();
  const rubiksCubeService = new RubiksCubeCourseService({
    repository: new FilesystemRubiksCubeProgressRepository({
      configService,
      store: schoolDocumentFileStore,
      courseId: RUBIKS_CUBE_COURSE_ID,
    }),
    recoverySolver: rubiksRecoverySolver,
    packetPlanner: new RubiksPacketPlanner({
      solver: rubiksRecoverySolver,
      idFactory: crypto.randomUUID,
    }),
    idFactory: crypto.randomUUID,
  });
  // A SPOKEN ANSWER to the interpretation rung. Null without an AI gateway,
  // and that is a supported configuration rather than a fault: the day then
  // says `voiceAnswer: false`, the interpretation rung needs a keyboard after
  // all, and typing is still the way through. The LANGUAGE profile, never the
  // fitness one — that profile's cleanup pass repairs what it misheard, which
  // pointed at a learner's translation would tidy a wrong answer into a right
  // one.
  //
  // Built ONCE, here, because two things must agree about it: the service
  // (which decides whether a keyboard-less panel is offered interpretation at
  // all) and the router (which serves the transcribe route and tells the
  // client whether to draw a microphone). Two constructions could differ.
  const languageTranscription = createLanguageTranscriptionService({
    openaiAdapter: scopedGateway(dependencies.sharedAiGateway, { app: 'school', feature: 'language' }),
    logger: rootLogger.child({ module: 'school-language-transcription' }),
  });
  const languageStudyService = createLanguageStudyService({
    datastore: new YamlLanguageStudyDatastore({ configService }),
    languageTranscription,
    // Meaning score on interpretation answers (SentenceMeaningJudge). Null
    // gateway → no field, rows unchanged. `language.meaning_judge.enabled:
    // false` in the school config turns it off where a gateway exists.
    decisionGateway: scopedGateway(dependencies.decisionGateway, { app: 'school', feature: 'language' }),
    meaningJudgeConfig: schoolFullConfig.language?.meaning_judge ?? null,
    readProgramEnrollment: (learnerId, corpusId) => languageAssignments.readProgramEnrollment(learnerId, corpusId),
    // Through the factory, so the bus is adapted to School's realtime port
    // rather than handed over raw under an option name the service does not
    // have. `new SentenceLadderService({ eventBus })` looked right here and
    // published nothing for months.
    eventBus,
    timezone: configService.getTimezone?.() || null,
    readGate: () => {
      const cfg = readGateConfig();
      if (cfg?.force === 'open') return { level: 'open', reason: 'forced-open', missing: [], stale: false };
      if (cfg?.force === 'closed') return { level: 'disabled', reason: 'forced-closed', missing: [], stale: false };
      return resolveGate({
        presence: presenceStore.get(cfg?.device_id || 'portal'),
        now: Date.now(),
        required: cfg?.devices || [],
        // `??` not `||`: an explicit ttl_ms of 0 must mean 0, not the default.
        ttlMs: cfg?.ttl_ms ?? undefined,
      });
    },
    logger: rootLogger.child({ module: 'school-language' })
  });
  return { schoolStudyGrants, schoolReelGrants, schoolCubeGrants, schoolBookGrants, schoolBookPanelGrants, schoolLaunchPreviewTokens, schoolDebriefGrants, languageReelService, rubiksCubeService, languageTranscription, languageStudyService };
}
