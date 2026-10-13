/**
 * RetractTeacherRecord — the gated eraser (advocacy B15): appends a
 * retraction against an enrichment entry, attestation, or standalone note.
 * Retracting an attestation re-locks the gates it opened BY CONSTRUCTION
 * (every reader folds retractions out of list()). The record itself
 * survives; only its effect ends.
 */
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';

const STORES = ['enrichment', 'attestation', 'note'];

export class RetractTeacherRecord {
  #stores; #teacherGate; #clock; #notes; #logger;

  /** @param {{stores: {enrichment, attestation, note}, teacherGate, clock?}} deps */
  constructor({ stores, teacherGate, notes = null, clock = () => new Date(), logger = console } = {}) {
    if (!stores) throw new Error('RetractTeacherRecord requires stores');
    if (!teacherGate) throw new Error('RetractTeacherRecord requires teacherGate');
    this.#stores = stores;
    this.#teacherGate = teacherGate;
    this.#clock = clock;
    this.#notes = notes;
    this.#logger = logger;
  }

  async execute({ kind, entryId, retractedBy = null, pin = null } = {}) {
    this.#teacherGate.assert({ userId: retractedBy, pin, action: 'record.retract', context: { kind, entryId } });
    if (!STORES.includes(kind)) throw new ValidationError(`kind must be one of ${STORES.join('|')}`);
    if (typeof entryId !== 'string' || !entryId.trim()) throw new ValidationError('entryId is required');
    const store = this.#stores[kind];
    if (!store) throw new EntityNotFoundError('retraction store', kind);
    if (!store.list().some((e) => e.id === entryId)) {
      throw new EntityNotFoundError(`${kind} entry`, entryId);
    }
    const target = store.list().find((e) => e.id === entryId);
    await store.retract(entryId, { by: retractedBy, at: this.#clock().toISOString() });
    // A withdrawn completion mark re-locks a child's gate — they hear it
    // rather than discovering a lock reappeared (student-advocacy A5).
    if (kind === 'attestation' && target?.learnerId) {
      try {
        await this.#notes?.append({
          id: `note_${Math.random().toString(36).slice(2, 10)}`, at: this.#clock().toISOString(),
          from: retractedBy, learnerId: target.learnerId,
          note: `The completion mark for ${target.unitId} was removed — that unit is back on your list.`,
        });
      } catch (err) {
        // Best-effort: the retraction itself already succeeded and must not be
        // undone by a failed courtesy note — but a child who was never told
        // their gate re-locked is exactly what a later review wants to see.
        this.#logger.warn?.('school.record.retract-note-failed', {
          learnerId: target.learnerId, entryId, error: err?.message,
        });
      }
    }
    this.#logger.info?.('school.record.retracted', {
      kind, entryId, retractedBy, learnerId: target?.learnerId ?? null,
    });
    return { retracted: entryId, kind };
  }
}
