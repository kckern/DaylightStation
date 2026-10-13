import { ValidationError, DomainInvariantError } from '#domains/core/errors/index.mjs';
import { stableRecordDigest } from '#apps/common/stableRecord.mjs';

/** Preview-first, idempotent teacher dispatch through the real receipt path. */
export class TeacherAgendaDispatch {
  #previewAgenda; #buildAgenda; #receipts; #teacherGate; #receiptStore; #clock; #logger; #requests = new Map();
  constructor({ previewAgenda, buildAgenda, receipts, teacherGate, receiptStore, clock = () => new Date(), logger = console } = {}) {
    if (!previewAgenda || !buildAgenda || !receipts || !teacherGate || !receiptStore) {
      throw new Error('TeacherAgendaDispatch requires previewAgenda, buildAgenda, receipts, teacherGate and receiptStore');
    }
    this.#previewAgenda = previewAgenda;
    this.#buildAgenda = buildAgenda;
    this.#receipts = receipts;
    this.#teacherGate = teacherGate;
    this.#receiptStore = receiptStore;
    this.#clock = clock;
    this.#logger = logger;
  }

  async preview({ learnerId, learnerName = null } = {}) {
    if (typeof learnerId !== 'string' || !learnerId.trim()) throw new ValidationError('learnerId is required');
    const result = await this.#previewAgenda.execute({ learnerId, learnerName });
    return { schema: 'school.agenda-dispatch-preview/v1', learnerId,
      ready: Boolean(result.document), sections: result.sections ?? [], entries: result.plan?.entries ?? [],
      errors: result.plan?.errors ?? [], documentId: result.document?.id ?? null };
  }

  async execute({ learnerId, learnerName = null, dispatchedBy = null, pin = null, idempotencyKey } = {}) {
    this.#teacherGate.assert({ userId: dispatchedBy, pin, action: 'agenda.dispatch', context: { learnerId } });
    if (typeof learnerId !== 'string' || !learnerId.trim()) throw new ValidationError('learnerId is required');
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) throw new ValidationError('Idempotency-Key is required');
    const key = idempotencyKey.trim();
    const fingerprint = stableRecordDigest({ learnerId, learnerName: learnerName ?? null, dispatchedBy });
    const prior = this.#requests.get(key);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new DomainInvariantError('Idempotency-Key was already used for another agenda dispatch', { code: 'IDEMPOTENCY_CONFLICT' });
      return { ...(await prior.promise), idempotent: true };
    }
    const promise = this.#dispatch({ learnerId, learnerName, dispatchedBy, idempotencyKey: key, fingerprint });
    this.#requests.set(key, { fingerprint, promise });
    try { return await promise; } finally { this.#requests.delete(key); }
  }

  async #dispatch({ learnerId, learnerName, dispatchedBy, idempotencyKey, fingerprint }) {
    const claimed = await this.#receiptStore.claim({ key: idempotencyKey, fingerprint, at: this.#clock().toISOString() });
    if (claimed.kind === 'conflict') {
      throw new DomainInvariantError('Idempotency-Key was already used for another agenda dispatch', { code: 'IDEMPOTENCY_CONFLICT' });
    }
    if (claimed.kind === 'pending') {
      throw new DomainInvariantError('Agenda dispatch outcome is indeterminate; use a new key for a deliberate reprint', { code: 'IDEMPOTENCY_INDETERMINATE' });
    }
    if (claimed.kind === 'replay') return { ...claimed.receipt, idempotent: true };
    const agenda = await this.#buildAgenda.execute({ learnerId, learnerName });
    const print = await this.#receipts.print(agenda.document);
    const receipt = { schema: 'school.agenda-dispatch-receipt/v1', learnerId, dispatchedBy,
      idempotencyKey, idempotent: false, at: this.#clock().toISOString(), documentId: agenda.document?.id ?? null,
      printed: print.printed, reason: print.reason, sections: agenda.sections ?? [], entries: agenda.plan?.entries ?? [] };
    await this.#receiptStore.complete({ key: idempotencyKey, fingerprint, receipt, at: this.#clock().toISOString() });
    this.#logger.info?.('school.agenda.teacher-dispatched', {
      learnerId, dispatchedBy, printed: receipt.printed, reason: receipt.reason, idempotencyKey,
    });
    return receipt;
  }
}

export default TeacherAgendaDispatch;
