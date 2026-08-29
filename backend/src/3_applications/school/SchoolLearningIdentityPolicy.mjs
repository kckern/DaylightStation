import { sha256Text } from '#system/utils/sha256.mjs';
import { hexId } from '#system/utils/id.mjs';

const nonEmptyString = (value) => typeof value === 'string' && value.length > 0;
const digest = (value, length) => sha256Text(value).slice(0, length).toUpperCase();

export function createLearningProbeEvidenceId({ observationId, learnerId }) {
  if (!nonEmptyString(observationId) || !nonEmptyString(learnerId)) {
    throw new Error('Learning probe evidence identity requires observation and learner IDs');
  }
  return `PROBE_${digest(`school-learning-probe/v1\n${learnerId}\n${observationId}`, 32)}`;
}

export function createLearningReflectionEvidenceId({ observationId, learnerId }) {
  if (!nonEmptyString(observationId) || !nonEmptyString(learnerId)) {
    throw new Error('Learning reflection evidence identity requires observation and learner IDs');
  }
  return `REFLECT_${digest(`school-learning-reflection/v1\n${learnerId}\n${observationId}`, 32)}`;
}

export function createRemediationSessionId({ learnerId, source }) {
  if (!nonEmptyString(learnerId) || !nonEmptyString(source?.externalId)) {
    throw new Error('Remediation session identity requires learner and source IDs');
  }
  return `REM_${digest(`school-remediation/v1\n${learnerId}\n${source.surface ?? ''}\n${source.externalId}`, 24)}`;
}

export function createRemediationTurnId(newHexId = () => hexId(8)) {
  const value = newHexId();
  if (!/^[0-9a-f]{16}$/i.test(value)) throw new Error('Remediation turn ID entropy source must return eight bytes');
  return `TURN_${value.toUpperCase()}`;
}
