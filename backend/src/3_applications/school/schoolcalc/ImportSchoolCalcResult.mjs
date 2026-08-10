import { EntityNotFoundError, ValidationError } from '#domains/core/errors/index.mjs';
import {
  validateSchoolCalcSubmission,
  verifySchoolCalcLocalScore,
} from '#domains/school/schoolcalc/index.mjs';
import { gradeAnswer } from '#domains/school/grading.mjs';
import { createLearningProbeEvidence } from '#domains/school/progress/index.mjs';

const TRANSPORTS = new Set(['qr', 'relay']);

/**
 * One importer for exact calculator records regardless of arrival transport.
 * The adapter decodes positions; this use case resolves stable School IDs and
 * invokes the existing grading/progress collaborators.
 */
export class ImportSchoolCalcResult {
  #codecs; #devices; #artifacts; #ledger; #grader; #progress; #remediationOffers; #probeEvidence;
  #studies; #studyOutcomes; #clock;

  constructor({
    codecs, devices, artifacts, ledger, grader, progress,
    remediationOffers = null, probeEvidenceRepository = null,
    studySessions = null, studyOutcomes = null, clock = () => new Date(),
  } = {}) {
    if (!codecs || !devices || !artifacts || !ledger || !grader || !progress) {
      throw new Error('ImportSchoolCalcResult requires codecs, devices, artifacts, ledger, grader, and progress');
    }
    this.#codecs = codecs;
    this.#devices = devices;
    this.#artifacts = artifacts;
    this.#ledger = ledger;
    this.#grader = grader;
    this.#progress = progress;
    this.#remediationOffers = remediationOffers;
    this.#probeEvidence = probeEvidenceRepository;
    this.#studies = studySessions;
    this.#studyOutcomes = studyOutcomes;
    this.#clock = clock;
  }

  async execute({ record, transport } = {}) {
    if (!TRANSPORTS.has(transport)) throw new ValidationError('SchoolCalc result transport must be qr|relay');
    const { codec, result } = this.#codecs.decodeResult(record);
    const device = await this.#devices.getDevice(result.deviceId);
    if (!device) throw new EntityNotFoundError('SchoolCalc device', result.deviceId);
    if (device.platformId !== codec.platformId) throw new ValidationError('SchoolCalc result codec does not match enrolled device platform');
    const learnerBinding = typeof device.resolveLearnerKey === 'function'
      ? device.resolveLearnerKey(result.learnerKey)
      : null;
    if (!learnerBinding) {
      throw new ValidationError(
        `SchoolCalc result learnerKey ${result.learnerKey} is not bound to device '${device.deviceId}'`,
      );
    }
    const artifact = await this.#artifacts.getArtifact(result.artifactId);
    if (!artifact) throw new EntityNotFoundError('SchoolCalc artifact', result.artifactId);
    if (artifact.platformId !== device.platformId) throw new ValidationError('SchoolCalc artifact platform does not match enrolled device');

    const adaptiveSession = result.adaptiveStudy
      ? await this.#validateAdaptiveResult({ result, device, learnerBinding, artifact })
      : null;
    if (adaptiveSession?.status === 'closed') {
      const duplicate = adaptiveSession.result?.resultDigest === result.recordDigest;
      return resultView(result, learnerBinding, {
        status: duplicate ? 'duplicate' : 'conflict', acknowledge: duplicate,
        receivedAt: readClock(this.#clock),
      });
    }

    const { submission, assessment } = resolveSubmission({ result, artifact });
    const validated = validateSchoolCalcSubmission(submission);
    if (validated.errors.length) throw new ValidationError(`SchoolCalc submission is invalid: ${validated.errors.join('; ')}`);
    const verifiedScore = submission.kind === 'responses'
      ? verifySchoolCalcLocalScore({
        localScore: submission.localScore,
        responses: submission.responses,
        bank: assessment.bank,
      })
      : null;
    if (verifiedScore?.errors.length) {
      throw new ValidationError(`SchoolCalc local score is inconsistent: ${verifiedScore.errors.join('; ')}`);
    }
    if (typeof result.recordDigest !== 'string' || !result.recordDigest) {
      throw new ValidationError('SchoolCalc codec did not provide a record digest');
    }

    const claim = await this.#ledger.claimResult({
      deviceId: result.deviceId,
      sequence: result.sequence,
      recordDigest: result.recordDigest,
    });
    const receivedAt = readClock(this.#clock);
    await this.#ledger.recordArrival({
      deviceId: result.deviceId,
      sequence: result.sequence,
      recordDigest: result.recordDigest,
      transport,
      receivedAt,
    });

    if (claim.status === 'conflict') {
      return resultView(result, learnerBinding, { status: 'conflict', acknowledge: false, receivedAt });
    }
    if (claim.status === 'duplicate') {
      return resultView(result, learnerBinding, {
        status: 'duplicate', acknowledge: true, receivedAt,
        remediation: structuredClone(claim.entry?.state?.remediation ?? null),
      });
    }
    if (claim.status !== 'new' && claim.status !== 'resume') {
      throw new Error(`SchoolCalc result ledger returned unknown claim status '${claim.status}'`);
    }

    const importStartedAt = claim.status === 'resume'
      ? resumeStartedAt(claim.entry, receivedAt)
      : receivedAt;
    await this.#ledger.saveImportState({
      deviceId: result.deviceId,
      sequence: result.sequence,
      state: {
        status: 'importing', kind: submission.kind,
        learnerId: learnerBinding.learnerId,
        startedAt: importStartedAt, lastAttemptedAt: receivedAt,
      },
    });

    let outcome;
    let remediation = null;
    if (submission.kind === 'responses') {
      outcome = await this.#grader.importSchoolCalcAssessment({
        learnerId: learnerBinding.learnerId,
        submission: validated.submission,
        bankSnapshot: assessment.bank,
        mode: assessment.mode,
        recordDigest: result.recordDigest,
        receivedAt: importStartedAt,
        learningContext: assessment.learningContext,
      });
      outcome = { ...outcome, score: verifiedScore.score };
      if (assessment.module.type === 'learning_probe') {
        if (!this.#probeEvidence || typeof this.#probeEvidence.appendEvidence !== 'function') {
          throw new Error('School learning-probe evidence repository is not configured');
        }
        outcome = {
          ...outcome,
          probeEvidence: await appendProbeTrace({
            repository: this.#probeEvidence,
            learnerId: learnerBinding.learnerId,
            resultId: `${submission.deviceId}:${submission.sequence}`,
            submission: validated.submission,
            assessment,
            occurredAt: importStartedAt,
            transport,
          }),
        };
      }
      if (this.#remediationOffers) {
        remediation = await this.#remediationOffers.execute({
          learnerId: learnerBinding.learnerId,
          source: {
            kind: 'assessment',
            surface: 'schoolcalc',
            endpointId: submission.deviceId,
            learnerKey: submission.learnerKey,
            externalId: `${submission.deviceId}:${submission.sequence}`,
            recordDigest: result.recordDigest,
            artifactId: submission.artifactId,
            lessonId: submission.lessonId,
            moduleId: submission.moduleId,
          },
          lesson: assessment.lesson,
          module: assessment.module,
          bank: assessment.bank,
          responses: validated.submission.responses,
        });
      }
      if (adaptiveSession) {
        const passingPercent = adaptiveSession.curation.policy.passingPercent;
        const settled = await this.#studyOutcomes.execute({
          studySession: adaptiveSession, percent: verifiedScore.score.percent,
          passingPercent, resultDigest: result.recordDigest, at: receivedAt, transport,
        });
        const closed = await this.#studies.close({
          studySessionId: adaptiveSession.studySessionId, resultDigest: result.recordDigest,
          outcome: settled.result, closedAt: receivedAt,
        });
        if (!['accepted', 'duplicate'].includes(closed.status)) {
          throw new ValidationError(`SchoolCalc study session closure conflict: ${closed.status}`);
        }
        outcome = { ...outcome, study: settled };
      }
    } else {
      outcome = await this.#progress.saveLatest({
        learnerId: learnerBinding.learnerId,
        deviceId: submission.deviceId,
        sequence: submission.sequence,
        artifactId: submission.artifactId,
        lessonId: submission.lessonId,
        moduleId: submission.moduleId,
        progress: structuredClone(submission.progress),
        recordDigest: result.recordDigest,
        timeBasis: 'backend_received',
        recordedAt: importStartedAt,
      });
    }

    await this.#ledger.saveImportState({
      deviceId: result.deviceId,
      sequence: result.sequence,
      state: {
        status: 'complete', kind: submission.kind,
        learnerId: learnerBinding.learnerId,
        startedAt: importStartedAt, completedAt: receivedAt,
        outcome: structuredClone(outcome), remediation: structuredClone(remediation),
      },
    });
    return resultView(result, learnerBinding, {
      status: 'accepted',
      acknowledge: true,
      resumed: claim.status === 'resume',
      receivedAt,
      outcome,
      remediation,
    });
  }

  async #validateAdaptiveResult({ result, device, learnerBinding, artifact }) {
    if (!this.#studies || !this.#studyOutcomes) {
      throw new ValidationError('Adaptive Study result handling is not configured');
    }
    const session = await this.#studies.getByCode(result.adaptiveStudy.sessionCode);
    if (!session) throw new ValidationError('Adaptive Study session code is unknown');
    if (session.learnerId !== learnerBinding.learnerId
        || session.artifact.artifactId !== artifact.artifactId
        || session.resolution?.deviceId !== device.deviceId
        || session.resolution?.learnerKey !== result.learnerKey) {
      throw new ValidationError('Adaptive Study result is not authorized for this learner/device/artifact');
    }
    const policy = session.curation.policy;
    if (result.moduleIndex !== 1
        || result.adaptiveStudy.cards.length !== policy.cardCount
        || result.adaptiveStudy.quizChoices.length !== policy.itemCount) {
      throw new ValidationError('Adaptive Study result counts do not match its prescription');
    }
    result.adaptiveStudy.cards.forEach((card, index) => {
      if (card.exposureCount > policy.maxExposuresPerCard
          || (card.rating !== 'know' && card.exposureCount !== policy.maxExposuresPerCard)) {
        throw new ValidationError(`Adaptive Study card ${index} has invalid final telemetry`);
      }
    });
    return session;
  }
}

function readClock(clock) {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) {
    throw new Error('SchoolCalc application clock must return a valid Date');
  }
  return value.toISOString();
}

function resumeStartedAt(entry, fallback) {
  const startedAt = entry?.state?.startedAt ?? entry?.arrivals?.[0]?.receivedAt;
  if (startedAt === undefined) return fallback;
  const parsed = new Date(startedAt);
  if (typeof startedAt !== 'string' || !Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== startedAt) {
    throw new Error('SchoolCalc result ledger has an invalid import startedAt');
  }
  return startedAt;
}

function resolveSubmission({ result, artifact }) {
  const bundle = artifact.interpretation?.bundle;
  if (artifact.interpretation?.schema !== 'school.calc.artifact-interpretation/v1' || !bundle?.lesson) {
    throw new ValidationError('SchoolCalc artifact has no valid interpretation metadata');
  }
  const module = bundle.lesson.modules?.[result.moduleIndex];
  if (!module) throw new ValidationError(`SchoolCalc result moduleIndex ${result.moduleIndex} is outside the artifact`);
  const common = {
    schema: 'school.calc.submission/v1',
    kind: result.kind,
    deviceId: result.deviceId,
    sequence: result.sequence,
    learnerKey: result.learnerKey,
    artifactId: result.artifactId,
    lessonId: bundle.lesson.lessonId,
    moduleId: module.moduleId,
  };
  if (result.kind === 'progress') {
    return { submission: { ...common, progress: structuredClone(result.progress) }, assessment: null };
  }

  const items = module.bank?.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw new ValidationError(`SchoolCalc module '${module.moduleId}' has no assessment bank`);
  }
  const responses = result.responses.map((response) => {
    const item = items[response.itemIndex];
    if (!item) throw new ValidationError(`SchoolCalc result itemIndex ${response.itemIndex} is outside module '${module.moduleId}'`);
    const given = resolveGiven(item, response.given);
    return {
      itemId: item.id,
      given,
      ...(response.probe ? {
        probe: {
          attempts: response.probe.attempts.map((attempt) => resolveGiven(item, attempt)),
          feedbackViewed: response.probe.feedbackViewed,
          continued: response.probe.continued,
        },
      } : {}),
    };
  });
  if (module.type === 'learning_probe') {
    if (responses.some(({ probe }) => !probe?.feedbackViewed || !probe?.continued)) {
      throw new ValidationError(`SchoolCalc learning probe '${module.moduleId}' has incomplete feedback telemetry`);
    }
  } else if (responses.some(({ probe }) => probe !== undefined)) {
    throw new ValidationError(`SchoolCalc module '${module.moduleId}' cannot accept learning-probe telemetry`);
  }
  return {
    submission: {
      ...common,
      responses,
      localScore: {
        ...structuredClone(result.localScore),
        basis: 'embedded_answer_key',
      },
    },
    assessment: {
      bank: structuredClone(module.bank),
      lesson: structuredClone(bundle.lesson),
      module: structuredClone(module),
      learningContext: learningContext(bundle, module),
      mode: module.type === 'flashcards' ? 'flashcard'
        : module.type === 'quiz' ? 'quiz'
          : module.type === 'learning_probe' ? 'learning_probe'
            : 'drill',
    },
  };
}

async function appendProbeTrace({
  repository, learnerId, resultId, submission, assessment, occurredAt, transport,
}) {
  const learning = assessment.learningContext;
  const source = {
    surface: 'calculator', transport, deviceId: submission.deviceId,
  };
  const statuses = [];
  for (const response of submission.responses) {
    const item = assessment.bank.items.find(({ id }) => id === response.itemId);
    const attempts = response.probe.attempts;
    for (let index = 0; index < attempts.length; index += 1) {
      const attemptNumber = index + 1;
      const common = {
        learnerId, occurredAt, attemptNumber, learning, source,
        activity: {
          id: assessment.module.bankId,
          sessionId: `schoolcalc:${resultId}`,
          itemId: response.itemId,
        },
      };
      // Attempt one is already persisted through the canonical School grader;
      // retries remain separate evidence and never alter that score.
      if (attemptNumber > 1) {
        const retry = createLearningProbeEvidence({
          ...common,
          evidenceId: probeEvidenceId(resultId, response.itemId, 'response', attemptNumber),
          event: 'response',
          correct: gradeAnswer(item, attempts[index]).correct,
        });
        statuses.push(await Promise.resolve(repository.appendEvidence(retry)));
      }
      const feedback = createLearningProbeEvidence({
        ...common,
        evidenceId: probeEvidenceId(resultId, response.itemId, 'feedback', attemptNumber),
        event: 'feedback_viewed',
      });
      statuses.push(await Promise.resolve(repository.appendEvidence(feedback)));
      const continuation = createLearningProbeEvidence({
        ...common,
        evidenceId: probeEvidenceId(resultId, response.itemId, 'continuation', attemptNumber),
        event: 'continuation',
        continuation: attemptNumber < attempts.length ? 'retry' : 'continue',
      });
      statuses.push(await Promise.resolve(repository.appendEvidence(continuation)));
    }
  }
  return Object.freeze({
    eventCount: statuses.length,
    recordedCount: statuses.filter(({ status }) => status === 'recorded').length,
    duplicateCount: statuses.filter(({ status }) => status === 'duplicate').length,
  });
}

function probeEvidenceId(resultId, itemId, event, attemptNumber) {
  return `probe:${resultId}:${itemId}:${event}:${attemptNumber}`;
}

function learningContext(bundle, module) {
  const context = bundle.context ?? {};
  return {
    ...(context.catalog?.catalogId ? { catalogId: context.catalog.catalogId } : {}),
    ...(context.subject?.subjectId ? { subjectId: context.subject.subjectId } : {}),
    ...(context.course?.courseId ? { courseId: context.course.courseId } : {}),
    ...(context.unit?.unitId ? { unitId: context.unit.unitId } : {}),
    ...(bundle.lesson?.lessonId ? { lessonId: bundle.lesson.lessonId } : {}),
    ...(module?.moduleId ? { moduleId: module.moduleId } : {}),
    areaIds: context.subject?.areaIds ?? [],
    classifications: [
      ...(context.course?.classifications ?? []),
      ...(bundle.lesson?.classifications ?? []),
    ],
    tags: [...new Set([
      ...(context.subject?.tags ?? []),
      ...(context.course?.tags ?? []),
      ...(context.unit?.tags ?? []),
      ...(bundle.lesson?.tags ?? []),
    ])],
  };
}

function resolveGiven(item, given) {
  if (item.type === 'multiple_choice' && Number.isInteger(given)) {
    const value = item.choices?.[given - 1];
    if (value === undefined) throw new ValidationError(`SchoolCalc choice ${given} is invalid for '${item.id}'`);
    return value;
  }
  if (item.type === 'asset_choice' && Number.isInteger(given)) {
    const value = item.choices?.[given - 1]?.value;
    if (value === undefined) throw new ValidationError(`SchoolCalc choice ${given} is invalid for '${item.id}'`);
    return value;
  }
  return structuredClone(given);
}

function resultView(result, learnerBinding, values) {
  return {
    deviceId: result.deviceId,
    sequence: result.sequence,
    learnerKey: result.learnerKey,
    learnerId: learnerBinding.learnerId,
    artifactId: result.artifactId,
    ...(result.kind === 'responses' ? { localScore: structuredClone(result.localScore) } : {}),
    ...values,
  };
}

export default ImportSchoolCalcResult;
