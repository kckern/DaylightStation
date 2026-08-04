/**
 * SchoolCalc composition root.
 *
 * This is the only backend module that knows the complete chain from School
 * application use cases to filesystem persistence, calculator-family codecs,
 * and HTTP.  Every dependency below points inward; neither School nor its
 * application layer needs to know that the first supported client is a TI-86.
 */

import path from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SchoolCalcContainer } from '#apps/school/schoolcalc/SchoolCalcContainer.mjs';
import {
  FsSchoolCalcArtifactRepository,
  YamlSchoolCalcDeviceRepository,
  YamlSchoolCalcProgressRepository,
  YamlSchoolCalcResultLedger,
} from '#adapters/schoolcalc/persistence/index.mjs';
import { Ti86SchoolCalcCodec } from '#adapters/schoolcalc/ti86/index.mjs';
import { HmacSchoolActionTokenIssuer } from '#adapters/school/actions/HmacSchoolActionTokenIssuer.mjs';
import { SchoolLearningActionExecutor } from '#adapters/school/actions/SchoolLearningActionExecutor.mjs';
import { YamlTokenRegistry } from '#adapters/persistence/yaml/YamlTokenRegistry.mjs';
import { createSchoolCalcRouter } from '#api/v1/routers/schoolCalc.mjs';

const RELAY_AUTH_SERVICE = 'ticalc-relay';
const MIN_RELAY_TOKEN_BYTES = 32;

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
  randomBytesFactory = randomBytes,
  remediationOffers = null,
  remediationTutor = null,
  probeEvidenceRepository = null,
  schoolCatalog = null,
} = {}) {
  assertCollaborators({
    configService, schoolService, learnerDirectory, learningProgress, randomBytesFactory,
  });
  const productConfig = configService.getHouseholdAppConfig(householdId, 'school')?.schoolcalc ?? null;
  if (!productConfig || productConfig.enabled !== true) {
    return inert('school.yml schoolcalc.enabled is not true');
  }
  if (!schoolCatalog?.wired || !schoolCatalog.catalogs || !schoolCatalog.content
      || !schoolCatalog.lessonBundles || !schoolCatalog.moduleRegistry
      || !schoolCatalog.accessPolicy) {
    throw new Error('SchoolCalc requires the shared School Catalog to be enabled');
  }

  const dataDirectory = configService.getDataDir();
  const {
    contentRoot, catalogDirectories, documentDirectories,
    questionBankDirectories: bankDirectories, actionDirectories,
  } = schoolCatalog.diagnostics;
  const stateRoot = productConfig.state?.root
    ? resolveFromData(dataDirectory, productConfig.state.root)
    : path.resolve(configService.getHouseholdAppPath('schoolcalc', '', householdId));

  const devices = new YamlSchoolCalcDeviceRepository({ directory: path.join(stateRoot, 'devices') });
  const artifacts = new FsSchoolCalcArtifactRepository({ directory: path.join(stateRoot, 'artifacts') });
  const resultLedger = new YamlSchoolCalcResultLedger({ directory: path.join(stateRoot, 'results') });
  const progress = new YamlSchoolCalcProgressRepository({ directory: path.join(stateRoot, 'progress') });
  const {
    catalogs, content, lessonBundles, moduleRegistry, accessPolicy: catalogAccess,
  } = schoolCatalog;
  // SchoolCalc and the printed School lifecycle must share this exact registry
  // instance so a code compiled into a calculator resolves through the same
  // revocation/policy record as a code printed on paper.
  const tokenRegistry = new YamlTokenRegistry({ configService, logger });
  const actionTokenKey = readActionTokenKey({ configService, householdId });
  const actionTokens = actionTokenKey
    ? new HmacSchoolActionTokenIssuer({ key: actionTokenKey, tokens: tokenRegistry, clock })
    : null;
  const actionExecutor = new SchoolLearningActionExecutor();
  if (!actionTokens) logger?.warn?.('schoolcalc.actions.unwired', {
    reason: "household auth 'schoolcalc.action_token_key' is not configured",
  });
  const codecs = [new Ti86SchoolCalcCodec()];
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
    deviceIdFactory: () => createCompactDeviceId(randomBytesFactory),
    actionTokens,
    actionExecutor,
    remediationOffers,
    remediationTutor,
    probeEvidenceRepository,
    logger,
    clock,
  });

  const credentials = readRelayCredentials({ configService, productConfig, householdId });
  if (credentials.length === 0) {
    logger?.warn?.('schoolcalc.ingress.unwired', {
      reason: 'no relay credentials',
      hint: `configure school.schoolcalc.ingress.relay_ids and household auth '${RELAY_AUTH_SERVICE}.relays'`,
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
      diagnostics: diagnostics({
        contentRoot, catalogDirectories, documentDirectories, bankDirectories, actionDirectories,
        stateRoot, credentials, actionTokens,
      }),
    };
  }

  const authenticateIngress = createSchoolCalcIngressAuthenticator({ credentials, logger });
  const router = createSchoolCalcRouter({ container, authenticateIngress });
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
    authenticateIngress,
    diagnostics: diagnostics({
      contentRoot, catalogDirectories, documentDirectories, bankDirectories, actionDirectories,
      stateRoot, credentials, actionTokens,
    }),
  };
}

/**
 * Authenticate a relay by a credential that maps to exactly one relay ID.
 * An optional identity header is only a consistency assertion; it can never
 * select a different identity than the bearer credential owns.
 */
export function createSchoolCalcIngressAuthenticator({ credentials, logger = null } = {}) {
  const normalized = normalizeCredentials(credentials);
  const byDigest = normalized.map(({ relayId, apiToken }) => ({
    relayId,
    digest: credentialDigest(apiToken),
  }));

  return (req, res, next) => {
    const token = bearerToken(req.get?.('Authorization'));
    const presentedDigest = token === null ? null : credentialDigest(token);
    const credential = presentedDigest === null
      ? null
      : byDigest.find(({ digest }) => timingSafeEqual(digest, presentedDigest)) ?? null;
    const assertedRelayId = req.get?.('X-SchoolCalc-Relay-Id') ?? null;
    if (!credential || (assertedRelayId && assertedRelayId !== credential.relayId)) {
      logger?.warn?.('schoolcalc.ingress.rejected', {
        assertedRelayId: assertedRelayId || null,
        reason: credential ? 'relay identity does not match credential' : 'invalid credential',
      });
      return res.status(401).json({ error: 'unauthorized' });
    }
    req.schoolCalcIngress = Object.freeze({ id: credential.relayId });
    return next();
  };
}

/** Exposed for configuration/contract tests; never returns token material. */
export function schoolCalcConfigurationView({ configService, householdId = null } = {}) {
  const productConfig = configService?.getHouseholdAppConfig?.(householdId, 'school')?.schoolcalc ?? null;
  if (!productConfig) return { enabled: false, relayIds: [], actionTokensConfigured: false };
  let relayIds = [];
  try {
    relayIds = readRelayCredentials({ configService, productConfig, householdId })
      .map(({ relayId }) => relayId);
  } catch {
    relayIds = [];
  }
  let actionTokensConfigured = false;
  try { actionTokensConfigured = Boolean(readActionTokenKey({ configService, householdId })); } catch { /* reported false */ }
  return { enabled: productConfig.enabled === true, relayIds, actionTokensConfigured };
}

function readActionTokenKey({ configService, householdId }) {
  const value = configService.getHouseholdAuth('schoolcalc', householdId)?.action_token_key ?? null;
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') < 32) {
    throw new Error("Household auth 'schoolcalc.action_token_key' must contain at least 32 bytes");
  }
  return value;
}

function readRelayCredentials({ configService, productConfig, householdId }) {
  const relayIds = productConfig.ingress?.relay_ids;
  if (relayIds === undefined) return [];
  if (!Array.isArray(relayIds) || relayIds.length === 0 || !relayIds.every(nonEmptyString)
    || new Set(relayIds).size !== relayIds.length) {
    throw new Error('schoolcalc.ingress.relay_ids must contain unique non-empty relay IDs');
  }
  const auth = configService.getHouseholdAuth(RELAY_AUTH_SERVICE, householdId);
  const configured = auth?.relays;
  if (!configured || typeof configured !== 'object' || Array.isArray(configured)) {
    throw new Error(`Household auth '${RELAY_AUTH_SERVICE}.relays' is required for SchoolCalc ingress`);
  }
  return normalizeCredentials(relayIds.map((relayId) => ({
    relayId,
    apiToken: configured[relayId]?.api_token,
  })));
}

function normalizeCredentials(credentials) {
  if (!Array.isArray(credentials) || credentials.length === 0) {
    throw new Error('SchoolCalc ingress requires at least one relay credential');
  }
  const relayIds = new Set();
  const tokenDigests = new Set();
  return credentials.map((credential) => {
    const relayId = credential?.relayId;
    const apiToken = credential?.apiToken;
    if (!nonEmptyString(relayId) || !/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(relayId)) {
      throw new Error('SchoolCalc relay credential has an invalid relayId');
    }
    if (typeof apiToken !== 'string' || Buffer.byteLength(apiToken, 'utf8') < MIN_RELAY_TOKEN_BYTES) {
      throw new Error(`SchoolCalc relay '${relayId}' api_token must be at least ${MIN_RELAY_TOKEN_BYTES} bytes`);
    }
    const digestKey = credentialDigest(apiToken).toString('hex');
    if (relayIds.has(relayId)) throw new Error(`Duplicate SchoolCalc relayId '${relayId}'`);
    if (tokenDigests.has(digestKey)) throw new Error('Every SchoolCalc relay must have a distinct api_token');
    relayIds.add(relayId);
    tokenDigests.add(digestKey);
    return Object.freeze({ relayId, apiToken });
  });
}

function resolveFromData(dataDirectory, value) {
  if (!nonEmptyString(value)) throw new Error('SchoolCalc path must be a non-empty string');
  return path.resolve(dataDirectory, value);
}

function createCompactDeviceId(randomBytesFactory) {
  const entropy = randomBytesFactory(6);
  if (!Buffer.isBuffer(entropy) && !(entropy instanceof Uint8Array)) {
    throw new Error('SchoolCalc device ID entropy source must return bytes');
  }
  if (entropy.byteLength !== 6) throw new Error('SchoolCalc device ID entropy source returned the wrong byte count');
  // Identity names the enrolled SchoolCalc device, not its current calculator
  // family. Platform remains a separate aggregate field so a future adapter
  // does not inherit a TI-86-shaped identity policy from composition.
  return `SC${Buffer.from(entropy).toString('hex').toUpperCase()}`;
}

function credentialDigest(token) { return createHash('sha256').update(token, 'utf8').digest(); }

function bearerToken(header) {
  if (typeof header !== 'string') return null;
  const match = /^Bearer ([^\s]+)$/.exec(header);
  return match?.[1] ?? null;
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
  if (typeof randomBytesFactory !== 'function') throw new Error('createSchoolCalc requires an entropy source');
}

function nonEmptyString(value) { return typeof value === 'string' && value.trim().length > 0; }

export default createSchoolCalc;
