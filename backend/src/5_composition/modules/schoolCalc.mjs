/**
 * SchoolCalc composition root.
 *
 * This is the only backend module that knows the complete chain from School
 * application use cases to filesystem persistence, calculator-family codecs,
 * and HTTP.  Every dependency below points inward; neither School nor its
 * application layer needs to know that the first supported client is a TI-86.
 */

import { SchoolCalcContainer } from '#apps/school/schoolcalc/SchoolCalcContainer.mjs';
import { createSchoolCalcPersistence } from '#adapters/schoolcalc/persistence/SchoolCalcPersistenceBundle.mjs';
import { SchoolCalcConfigProjection, schoolCalcConfigurationView } from '#adapters/schoolcalc/SchoolCalcConfigProjection.mjs';
import { SchoolCalcRelayCredentialVerifier } from '#adapters/schoolcalc/SchoolCalcRelayCredentialVerifier.mjs';
import { Ti86SchoolCalcCodec } from '#adapters/schoolcalc/ti86/index.mjs';
import { EnsureSchoolCalcStudySession } from '#apps/school/schoolcalc/EnsureSchoolCalcStudySession.mjs';
import { BuildAdaptiveStudyArtifact } from '#apps/school/schoolcalc/BuildAdaptiveStudyArtifact.mjs';
import { SchoolCalcStudyOutcomeExecutor } from '#apps/school/schoolcalc/SchoolCalcStudyOutcomeExecutor.mjs';
import { HmacSchoolActionTokenIssuer } from '#adapters/school/actions/HmacSchoolActionTokenIssuer.mjs';
import { SchoolLearningActionExecutor } from '#adapters/school/actions/SchoolLearningActionExecutor.mjs';
import { YamlTokenRegistry } from '#adapters/persistence/yaml/YamlTokenRegistry.mjs';
import { createSchoolCalcRouter } from '#api/v1/routers/schoolCalc.mjs';
import { createSchoolCalcIngressAuthenticator } from '#api/v1/middleware/schoolCalcIngress.mjs';
import { SchoolCalcIdentityPolicy } from '#apps/school/schoolcalc/SchoolCalcIdentityPolicy.mjs';
import { entropyBytes } from '#system/utils/id.mjs';

export { createSchoolCalcIngressAuthenticator, schoolCalcConfigurationView };

/**
 * Build the optional SchoolCalc product module from household configuration.
 * An absent/disabled configuration creates no persistence and mounts no API.
 */
export function createSchoolCalc({
  configService,
  schoolService,
  learnerDirectory,
  learningProgress,
  householdId = null,
  logger = null,
  clock = () => new Date(),
  randomBytesFactory = entropyBytes,
  remediationOffers = null,
  remediationTutor = null,
  probeEvidenceRepository = null,
  schoolCatalog = null,
} = {}) {
  assertCollaborators({
    configService, schoolService, learnerDirectory, learningProgress, randomBytesFactory,
  });
  const projection = new SchoolCalcConfigProjection({ configService, householdId }).read();
  if (!projection.enabled) return inert(projection.reason);
  if (!schoolCatalog?.wired || !schoolCatalog.catalogs || !schoolCatalog.content
      || !schoolCatalog.lessonBundles || !schoolCatalog.moduleRegistry
      || !schoolCatalog.accessPolicy) {
    throw new Error('SchoolCalc requires the shared School Catalog to be enabled');
  }

  const { stateRoot, relayCredentials: credentials, actionTokenKey, relayConfigurationHint } = projection;
  const {
    contentRoot, catalogDirectories, documentDirectories,
    questionBankDirectories: bankDirectories, actionDirectories,
  } = schoolCatalog.diagnostics;
  const { devices, artifacts, resultLedger, progress, studies } = createSchoolCalcPersistence({ stateRoot });
  const identities = new SchoolCalcIdentityPolicy({ randomBytesFactory });
  const ti86Codec = new Ti86SchoolCalcCodec();
  const adaptiveArtifacts = new BuildAdaptiveStudyArtifact({ codec: ti86Codec, artifacts });
  const studyOutcomeExecutor = new SchoolCalcStudyOutcomeExecutor();
  const studySessions = new EnsureSchoolCalcStudySession({
    studies,
    banks: { getBank: (id) => schoolService.getBank(id) },
    artifacts: adaptiveArtifacts,
    newStudySessionId: () => identities.studySessionId(),
    newCode: () => identities.studyCode(),
  });
  const {
    catalogs, content, lessonBundles, moduleRegistry, accessPolicy: catalogAccess,
  } = schoolCatalog;
  // SchoolCalc and the printed School lifecycle must share this exact registry
  // instance so a code compiled into a calculator resolves through the same
  // revocation/policy record as a code printed on paper.
  const tokenRegistry = new YamlTokenRegistry({ configService, logger });
  const actionTokens = actionTokenKey
    ? new HmacSchoolActionTokenIssuer({ key: actionTokenKey, tokens: tokenRegistry, clock })
    : null;
  const actionExecutor = new SchoolLearningActionExecutor();
  if (!actionTokens) logger?.warn?.('schoolcalc.actions.unwired', {
    reason: "household auth 'schoolcalc.action_token_key' is not configured",
  });
  const codecs = [ti86Codec];
  const container = new SchoolCalcContainer({
    codecs,
    catalogs,
    content,
    artifacts,
    devices,
    resultLedger,
    progress,
    learningProgress,
    grader: schoolService,
    learners: learnerDirectory,
    catalogAccess,
    lessonBundles,
    moduleRegistry,
    deviceIdFactory: () => identities.deviceId(),
    actionTokens,
    actionExecutor,
    remediationOffers,
    remediationTutor,
    probeEvidenceRepository,
    studySessions: studies,
    studyCodec: ti86Codec,
    studyOutcomes: studyOutcomeExecutor,
    logger,
    clock,
  });

  if (credentials.length === 0) {
    logger?.warn?.('schoolcalc.ingress.unwired', {
      reason: 'no relay credentials',
      hint: relayConfigurationHint,
    });
    return {
      wired: false,
      reason: 'no configured relay credentials',
      container,
      router: null,
      resultImporter: container.importResult,
      tokenRegistry,
      actionTokens,
      actionExecutor,
      actionResolver: container.resolveAction,
      studySessions: null,
      studyOutcomeExecutor,
      diagnostics: diagnostics({
        contentRoot, catalogDirectories, documentDirectories, bankDirectories, actionDirectories,
        stateRoot, credentials, actionTokens,
      }),
    };
  }

  const authenticateIngress = createSchoolCalcIngressAuthenticator({
    credentialVerifier: new SchoolCalcRelayCredentialVerifier({ credentials }),
    logger,
  });
  const router = createSchoolCalcRouter({
    operations: {
      enrollDevice: container.enrollDevice,
      identifyDevice: container.identifyDevice,
      observeDevice: container.observeDevice,
      getLearnerRoster: container.getLearnerRoster,
      getProgressProjection: container.getProgressProjection,
      resolveFollowUp: container.resolveFollowUp,
      getCatalog: container.getCatalog,
      requestDelivery: container.requestDelivery,
      getArtifact: container.getArtifact,
      importResult: container.importResult,
      syncDevice: container.syncDevice,
      remediationTutor: container.remediationTutor,
    },
    authenticateIngress,
  });
  logger?.info?.('schoolcalc.ready', {
    platforms: container.codecRegistry.listPlatformIds(),
    relayIds: credentials.map(({ relayId }) => relayId),
  });
  return {
    wired: true,
    reason: null,
    container,
    router,
    resultImporter: container.importResult,
    tokenRegistry,
    actionTokens,
    actionExecutor,
    actionResolver: container.resolveAction,
    studySessions,
    studyOutcomeExecutor,
    authenticateIngress,
    diagnostics: diagnostics({
      contentRoot, catalogDirectories, documentDirectories, bankDirectories, actionDirectories,
      stateRoot, credentials, actionTokens,
    }),
  };
}

function diagnostics({
  contentRoot, catalogDirectories, documentDirectories, bankDirectories, actionDirectories,
  stateRoot, credentials, actionTokens,
}) {
  return Object.freeze({
    platforms: Object.freeze(['ti86']),
    contentRoot,
    catalogDirectories: Object.freeze([...catalogDirectories]),
    documentDirectories: Object.freeze([...documentDirectories]),
    questionBankDirectories: Object.freeze([...bankDirectories]),
    actionDirectories: Object.freeze([...actionDirectories]),
    actionTokensConfigured: Boolean(actionTokens),
    stateRoot,
    relayIds: Object.freeze(credentials.map(({ relayId }) => relayId)),
  });
}

function inert(reason) {
  return Object.freeze({
    wired: false,
    reason,
    container: null,
    router: null,
    resultImporter: null,
    tokenRegistry: null,
    actionTokens: null,
    actionExecutor: null,
    actionResolver: null,
    studySessions: null,
    studyOutcomeExecutor: null,
    diagnostics: Object.freeze({ platforms: [], relayIds: [], actionTokensConfigured: false }),
  });
}

function assertCollaborators({
  configService, schoolService, learnerDirectory, learningProgress, randomBytesFactory,
}) {
  if (typeof configService?.getHouseholdAppConfig !== 'function'
    || typeof configService?.getDataDir !== 'function'
    || typeof configService?.getHouseholdAppPath !== 'function'
    || typeof configService?.getHouseholdPath !== 'function'
    || typeof configService?.getHouseholdAuth !== 'function') {
    throw new Error('createSchoolCalc requires a ConfigService');
  }
  if (!schoolService || typeof schoolService.importSchoolCalcAssessment !== 'function') {
    throw new Error('createSchoolCalc requires SchoolService grading support');
  }
  if (typeof learnerDirectory?.listLearners !== 'function'
      || typeof learnerDirectory?.hasLearner !== 'function') {
    throw new Error('createSchoolCalc requires a School learner directory');
  }
  if (typeof learningProgress?.execute !== 'function') {
    throw new Error('createSchoolCalc requires generic School progress queries');
  }
  if (typeof randomBytesFactory !== 'function') {
    throw new Error('createSchoolCalc requires an entropy source');
  }
}

export default createSchoolCalc;
