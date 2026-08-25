import { ValidationError, EntityNotFoundError, DomainInvariantError } from '#domains/core/errors/index.mjs';
import { createEvent, reduceSession } from '#domains/school/sessions/sessionEvents.mjs';

const present = (value) => typeof value === 'string' && value.trim();

/** Reprint an exact retained thermal receipt without generating a new artifact. */
export class ReprintResultReceiptArtifact {
  #artifacts; #sessions; #teacherGate; #printer; #clock;
  constructor({ issuedArtifacts, sessions, teacherGate, receiptArtifactPrinter,
    clock = () => new Date() } = {}) {
    if (!issuedArtifacts || !sessions || !teacherGate || !receiptArtifactPrinter) {
      throw new Error('ReprintResultReceiptArtifact requires artifacts, sessions, teacherGate and receiptArtifactPrinter');
    }
    this.#artifacts = issuedArtifacts; this.#sessions = sessions; this.#teacherGate = teacherGate;
    this.#printer = receiptArtifactPrinter; this.#clock = clock;
  }

  async execute({ artifactId, reprintedBy, pin, idempotencyKey, apply = false } = {}) {
    if (!present(artifactId) || !present(idempotencyKey)) throw new ValidationError('artifactId and idempotencyKey are required');
    this.#teacherGate.assert({ userId: reprintedBy, pin,
      action: apply ? 'artifact.reprint' : 'artifact.reprint.preview', context: { artifactId } });
    const artifact = await this.#artifacts.get(artifactId);
    if (!artifact) throw new EntityNotFoundError('issued artifact', artifactId);
    if (!['result-receipt', 'result-correction'].includes(artifact.manifest.kind)
      || artifact.manifest.representation?.mediaType !== 'image/png') {
      throw new DomainInvariantError('artifact is not a retained thermal receipt', { code: 'ARTIFACT_KIND_MISMATCH' });
    }
    const sessionId = artifact.manifest.sessionId;
    const events = await this.#sessions.readEvents(sessionId);
    const state = reduceSession(events);
    if (!state.resultReceiptArtifacts.some((row) => row.artifactId === artifactId)) {
      throw new DomainInvariantError('receipt artifact is not linked to its session', { code: 'ARTIFACT_LINEAGE_MISMATCH' });
    }
    const prior = events.find((event) => event.type === 'result_receipt_reprinted' && event.idempotencyKey === idempotencyKey);
    const preview = { schema: 'school.receipt-reprint-receipt/v1', applied: false,
      idempotent: Boolean(prior), artifactId, sessionId, byteLength: artifact.bytes.length,
      sha256: artifact.manifest.sha256, kind: artifact.manifest.kind };
    if (prior) return { ...preview, applied: true };
    if (!apply) return preview;
    const printed = await this.#printer.print({ bytes: artifact.bytes, representation: artifact.manifest.representation,
      jobName: `school-receipt-reprint-${artifactId}` });
    if (printed !== true) throw new DomainInvariantError('thermal printer did not confirm the reprint', { code: 'PRINT_NOT_CONFIRMED' });
    const built = createEvent({ type: 'result_receipt_reprinted', at: this.#clock().toISOString(), sessionId,
      artifactId, confirmed: true, idempotencyKey, reprintedBy });
    if (built.errors.length) throw new ValidationError(built.errors.join('; '));
    await this.#sessions.appendEvent(sessionId, built.event);
    return { ...preview, applied: true };
  }
}

export default ReprintResultReceiptArtifact;
