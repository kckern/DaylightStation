/** Shared School learning-loop wiring; no surface or subject owns this state. */
import { YamlRemediationSessionRepository } from '#adapters/school/persistence/YamlRemediationSessionRepository.mjs';
import {
  AdaptiveRemediationFollowUpSource,
  AdaptiveRemediationTutor,
  CreateAdaptiveRemediationOffer,
} from '#apps/school/remediation/index.mjs';
import { RecordLearningProbeInteraction } from '#apps/school/RecordLearningProbeInteraction.mjs';
import {
  createLearningProbeEvidenceId,
  createRemediationSessionId,
  createRemediationTurnId,
} from '#apps/school/SchoolLearningIdentityPolicy.mjs';

export {
  createLearningProbeEvidenceId,
  createLearningReflectionEvidenceId,
  createRemediationSessionId,
  createRemediationTurnId,
} from '#apps/school/SchoolLearningIdentityPolicy.mjs';

export function createSchoolLearningLoop({
  configService,
  householdId = null,
  aiGateway = null,
  logger = null,
  clock = () => new Date(),
  newTurnHexId,
  evidenceRepository = null,
  learnerDirectory = null,
} = {}) {
  if (!configService || typeof configService.getHouseholdPath !== 'function'
      || (newTurnHexId !== undefined && typeof newTurnHexId !== 'function')) {
    throw new Error('School learning-loop composition requires configService');
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
    turnIdFactory: () => createRemediationTurnId(newTurnHexId),
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

export default createSchoolLearningLoop;
