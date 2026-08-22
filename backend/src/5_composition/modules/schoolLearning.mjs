/** Shared School learning-loop wiring; no surface or subject owns this state. */
import { createHash, randomBytes } from 'node:crypto';
import { YamlRemediationSessionRepository } from '#adapters/school/persistence/YamlRemediationSessionRepository.mjs';
import {
  AdaptiveRemediationFollowUpSource,
  AdaptiveRemediationTutor,
  CreateAdaptiveRemediationOffer,
} from '#apps/school/remediation/index.mjs';
import { RecordLearningProbeInteraction } from '#apps/school/RecordLearningProbeInteraction.mjs';

export function createSchoolLearningLoop({
  configService,
  householdId = null,
  aiGateway = null,
  logger = null,
  clock = () => new Date(),
  randomBytesFactory = randomBytes,
  evidenceRepository = null,
  learnerDirectory = null,
} = {}) {
  if (!configService || typeof configService.getHouseholdPath !== 'function'
      || typeof randomBytesFactory !== 'function') {
    throw new Error('School learning-loop composition requires configService and entropy');
  }
  const sessions = new YamlRemediationSessionRepository({
    directory: configService.getHouseholdPath('school/runtime/remediation', householdId),
  });
  const offers = new CreateAdaptiveRemediationOffer({
    sessions,
    sessionIdFactory: createRemediationSessionId,
    clock,
  });
  const tutor = new AdaptiveRemediationTutor({
    sessions,
    aiGateway,
    turnIdFactory: () => createRemediationTurnId(randomBytesFactory),
    clock,
    logger,
  });
  const probeInteractions = evidenceRepository && learnerDirectory
    ? new RecordLearningProbeInteraction({
      evidenceRepository,
      learnerDirectory,
      evidenceIdFactory: createLearningProbeEvidenceId,
      clock,
    })
    : null;
  return Object.freeze({
    sessions,
    offers,
    tutor,
    followUps: new AdaptiveRemediationFollowUpSource({ sessions }),
    probeInteractions,
  });
}

export function createLearningProbeEvidenceId({ observationId, learnerId }) {
  if (!nonEmptyString(observationId) || !nonEmptyString(learnerId)) {
    throw new Error('Learning probe evidence identity requires observation and learner IDs');
  }
  const digest = createHash('sha256')
    .update(`school-learning-probe/v1\n${learnerId}\n${observationId}`)
    .digest('hex').slice(0, 32).toUpperCase();
  return `PROBE_${digest}`;
}

export function createLearningReflectionEvidenceId({ observationId, learnerId }) {
  if (!nonEmptyString(observationId) || !nonEmptyString(learnerId)) {
    throw new Error('Learning reflection evidence identity requires observation and learner IDs');
  }
  const digest = createHash('sha256')
    .update(`school-learning-reflection/v1\n${learnerId}\n${observationId}`)
    .digest('hex').slice(0, 32).toUpperCase();
  return `REFLECT_${digest}`;
}

export function createRemediationSessionId({ learnerId, source }) {
  if (!nonEmptyString(learnerId) || !nonEmptyString(source?.externalId)) {
    throw new Error('Remediation session identity requires learner and source IDs');
  }
  const digest = createHash('sha256')
    .update(`school-remediation/v1\n${learnerId}\n${source.surface ?? ''}\n${source.externalId}`)
    .digest('hex').slice(0, 24).toUpperCase();
  return `REM_${digest}`;
}

export function createRemediationTurnId(randomBytesFactory = randomBytes) {
  const entropy = randomBytesFactory(8);
  if (!Buffer.isBuffer(entropy) && !(entropy instanceof Uint8Array)) {
    throw new Error('Remediation turn ID entropy source must return bytes');
  }
  if (entropy.byteLength !== 8) throw new Error('Remediation turn ID entropy source returned the wrong byte count');
  return `TURN_${Buffer.from(entropy).toString('hex').toUpperCase()}`;
}

function nonEmptyString(value) { return typeof value === 'string' && value.length > 0; }

export default createSchoolLearningLoop;
