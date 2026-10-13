/**
 * RecordAttestation — "I verify this was done" (spec D2): a gated,
 * attributed override for when the tech (Portal, calculator, bubble sheets)
 * failed a child who did the work. Its own evidence kind — the planner and
 * milestones honor it as a pass, the report card never reads it.
 */
import { ValidationError } from '#domains/core/errors/index.mjs';

export class RecordAttestation {
  #log; #teacherGate; #clock; #idGen; #notes;

  constructor({ log, teacherGate, notes = null, clock = () => new Date(), idGen = () => `att_${Math.random().toString(36).slice(2, 10)}` } = {}) {
    if (!log) throw new Error('RecordAttestation requires log');
    if (!teacherGate) throw new Error('RecordAttestation requires teacherGate');
    this.#log = log;
    this.#teacherGate = teacherGate;
    this.#clock = clock;
    this.#notes = notes;
    this.#idGen = idGen;
  }

  async execute({ learnerId, unitId, reason, attestedBy = null, pin = null } = {}) {
    this.#teacherGate.assert({ userId: attestedBy, pin, action: 'attestation.record', context: { learnerId, unitId } });
    if (typeof learnerId !== 'string' || !learnerId.trim()) throw new ValidationError('learnerId is required');
    if (typeof unitId !== 'string' || !unitId.trim()) throw new ValidationError('unitId is required');
    if (typeof reason !== 'string' || !reason.trim()) throw new ValidationError('a reason is required — an override without one is unauditable');
    const entry = {
      id: this.#idGen(),
      at: this.#clock().toISOString(),
      attestedBy,
      learnerId,
      unitId,
      reason: reason.trim(),
    };
    await this.#log.append(entry);
    // The child hears the vouch too (student-advocacy A5).
    try {
      await this.#notes?.append({
        id: `note_${Math.random().toString(36).slice(2, 10)}`, at: entry.at, from: attestedBy,
        learnerId, note: `A grown-up verified you completed this unit: ${unitId}. It counts.`,
      });
    } catch { /* best-effort */ }
    return { entry };
  }
}
