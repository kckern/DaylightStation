import { ValidationError, EntityNotFoundError, DomainInvariantError } from '#domains/core/errors/index.mjs';
import { createEvent, reduceSession, statesAccepting } from '#domains/school/sessions/sessionEvents.mjs';

const present = (value) => typeof value === 'string' && value.trim();

// Derived from the transition table, never hand-copied: the states a `reprinted`
// event may legally be appended from. `YamlWorkSessionDatastore.appendEvent`
// refuses every other one, and it refuses AFTER `printPdf` has already put paper
// in the tray — so this use case has to ask the same question BEFORE it prints,
// or a teacher reprinting handed-in work gets a sheet, a 500, and another sheet
// on every retry (the `reprinted` event carrying the idempotency key never lands,
// so the replay short-circuit can never fire either).
const REPRINTABLE = statesAccepting('reprinted');

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
    // Ordered AFTER the idempotency replay above on purpose: a retried request
    // for a reprint that already happened is still answerable from the log, even
    // once the child has handed the sheet back in. It is a NEW reprint of work
    // that has moved on that has nowhere to be recorded.
    if (!REPRINTABLE.has(state.state)) {
      this.#logger.warn?.('school.artifact.reprint-refused', {
        artifactId, sessionId, reprintedBy, state: state.state,
      });
      throw new DomainInvariantError(
        `this work is already ${state.state ?? 'unrecorded'} and can no longer be reprinted`,
        { code: 'SESSION_NOT_REPRINTABLE', details: { sessionId, state: state.state } },
      );
    }
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
