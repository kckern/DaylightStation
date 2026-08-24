import { ValidationError, EntityNotFoundError, DomainInvariantError } from '#domains/core/errors/index.mjs';
import { createEvent, reduceSession } from '#domains/school/sessions/sessionEvents.mjs';

const present = (value) => typeof value === 'string' && value.trim();

/** Reprint immutable retained bytes without allocating a new card or artifact. */
export class ReprintIssuedArtifact {
  #artifacts; #sessions; #printer; #teacherGate; #exceptions; #clock; #logger;
  constructor({ issuedArtifacts, sessions, printer, teacherGate, curriculumExceptions = null,
    clock = () => new Date(), logger = console } = {}) {
    if (!issuedArtifacts || !sessions || !printer || !teacherGate) throw new Error('ReprintIssuedArtifact requires artifacts, sessions, printer and teacherGate');
    this.#artifacts = issuedArtifacts; this.#sessions = sessions; this.#printer = printer;
    this.#teacherGate = teacherGate; this.#clock = clock; this.#logger = logger;
    this.#exceptions = curriculumExceptions;
  }

  async execute({ artifactId, reprintedBy, pin, idempotencyKey, apply = false } = {}) {
    if (!present(artifactId) || !present(idempotencyKey)) throw new ValidationError('artifactId and idempotencyKey are required');
    this.#teacherGate.assert({ userId: reprintedBy, pin,
      action: apply ? 'artifact.reprint' : 'artifact.reprint.preview', context: { artifactId } });
    const artifact = await this.#artifacts.get(artifactId);
    if (!artifact) throw new EntityNotFoundError('issued artifact', artifactId);
    const { sessionId, allocation } = artifact.manifest;
    const events = await this.#sessions.readEvents(sessionId);
    const state = reduceSession(events);
    const paused = (await this.#exceptions?.active?.() ?? [])
      .some((exception) => exception.kind === 'paused' && exception.resolvedLessonIds?.includes(state.unitId));
    if (paused) throw new DomainInvariantError('paused curriculum cannot be reprinted', { code: 'CURRICULUM_PAUSED' });
    if (!state.issuedArtifacts.includes(artifactId)) throw new DomainInvariantError('artifact is not linked to its recorded session', { code: 'ARTIFACT_LINEAGE_MISMATCH' });
    const prior = events.find((event) => event.type === 'reprinted' && event.idempotencyKey === idempotencyKey);
    if (prior) return { schema: 'school.artifact-reprint-receipt/v1', applied: true, idempotent: true,
      artifactId, sessionId, cardId: allocation?.cardId ?? null, sha256: artifact.manifest.sha256 };
    const preview = { schema: 'school.artifact-reprint-receipt/v1', applied: false, idempotent: false,
      artifactId, sessionId, cardId: allocation?.cardId ?? null, rowRange: allocation?.rowRange ?? null,
      byteLength: artifact.bytes.length, sha256: artifact.manifest.sha256 };
    if (!apply) return preview;
    const result = await this.#printer.printPdf(artifact.bytes, { jobName: `school-reprint-${artifactId}`, user: state.learnerId });
    if (result?.confirmed === false || result?.printed === false) throw new DomainInvariantError('printer did not confirm the reprint', { code: 'PRINT_NOT_CONFIRMED' });
    const built = createEvent({ type: 'reprinted', at: this.#clock().toISOString(), sessionId, artifactId,
      confirmed: true, idempotencyKey, reprintedBy });
    if (built.errors.length) throw new ValidationError(built.errors.join('; '));
    await this.#sessions.appendEvent(sessionId, built.event);
    this.#logger.info?.('school.artifact.reprinted', { artifactId, sessionId, reprintedBy, idempotencyKey });
    return { ...preview, applied: true };
  }
}

export default ReprintIssuedArtifact;
