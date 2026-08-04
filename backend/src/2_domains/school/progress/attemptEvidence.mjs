import { validateLearningEvidence } from './learningProgress.mjs';

/**
 * Translate the canonical School attempt event into the shared progress
 * evidence language. Quiz/drill answers are verified accuracy evidence;
 * flashcard self-grades remain engagement evidence and never enter accuracy.
 */
export function learningEvidenceFromAttempt(attempt) {
  if (!attempt || typeof attempt !== 'object' || Array.isArray(attempt)) {
    throw new TypeError('School attempt evidence requires an attempt mapping');
  }
  const transport = String(attempt.transport ?? 'screen');
  const graded = attempt.mode === 'quiz' || attempt.mode === 'drill' || attempt.mode === 'learning_probe';
  const learning = {
    ...(attempt.learning ?? {}),
    ...(!attempt.learning?.subjectId && inferredSubject(attempt.bankId)
      ? { subjectId: inferredSubject(attempt.bankId) }
      : {}),
  };
  const raw = {
    schema: 'school.learning-evidence/v1',
    evidenceId: attempt.id,
    learnerId: attempt.attributedTo,
    occurredAt: attempt.at,
    verification: graded ? 'verified' : 'self_reported',
    activity: {
      id: attempt.bankId,
      kind: attempt.mode,
      sessionId: attempt.sessionId,
      itemId: attempt.itemId,
      graded,
      ...(attempt.mode === 'learning_probe' ? {
        attemptNumber: attempt.provenance?.probe?.attemptNumber ?? 1,
      } : {}),
    },
    learning,
    measures: {
      engagements: 1,
      responses: graded ? 1 : 0,
      correct: graded && attempt.correct === true ? 1 : 0,
    },
    source: {
      surface: transport === 'calculator' ? 'calculator'
        : transport === 'paper' ? 'paper'
          : 'web',
      transport,
      ...(attempt.provenance?.schoolCalc?.deviceId
        ? { deviceId: attempt.provenance.schoolCalc.deviceId }
        : {}),
    },
  };
  const result = validateLearningEvidence(raw);
  if (result.errors.length) throw new TypeError(`School attempt cannot become progress evidence: ${result.errors.join('; ')}`);
  return result.evidence;
}

function inferredSubject(bankId) {
  if (typeof bankId !== 'string' || !bankId.includes('/')) return null;
  return bankId.split('/')[0] || null;
}

export default learningEvidenceFromAttempt;
