/**
 * RecordEnrichment — the gated enrichment-log append (plan W3-4, spec B6):
 * an attributed record of out-of-band learning. Never graded evidence; the
 * report side (spec C5, wave 4) renders it as its own credit section and
 * excuses pacing with it.
 */
import { ValidationError } from '#domains/core/errors/index.mjs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class RecordEnrichment {
  #log; #teacherGate; #clock; #idGen;

  constructor({ log, teacherGate, clock = () => new Date(), idGen = () => `enr_${Math.random().toString(36).slice(2, 10)}` } = {}) {
    if (!log) throw new Error('RecordEnrichment requires log');
    if (!teacherGate) throw new Error('RecordEnrichment requires teacherGate');
    this.#log = log;
    this.#teacherGate = teacherGate;
    this.#clock = clock;
    this.#idGen = idGen;
  }

  async execute({
    recordedBy = null, pin = null, learnerIds = [], from, to = null,
    title, subjectIds = [], note = null,
  } = {}) {
    this.#teacherGate.assert({ userId: recordedBy, pin, action: 'enrichment.record', context: { title } });
    if (typeof title !== 'string' || !title.trim()) throw new ValidationError('title is required');
    if (!Array.isArray(learnerIds) || learnerIds.length === 0) throw new ValidationError('at least one learner is required');
    if (typeof from !== 'string' || !DATE_RE.test(from)) throw new ValidationError('from must be YYYY-MM-DD');
    const end = to ?? from;
    if (typeof end !== 'string' || !DATE_RE.test(end) || end < from) throw new ValidationError('to must be YYYY-MM-DD, not before from');
    const entry = {
      id: this.#idGen(),
      at: this.#clock().toISOString(),
      recordedBy,
      learnerIds: [...learnerIds],
      from,
      to: end,
      title: title.trim(),
      subjectIds: Array.isArray(subjectIds) ? [...subjectIds] : [],
      ...(note ? { note: String(note) } : {}),
    };
    await this.#log.append(entry);
    return { entry };
  }
}
