/**
 * RecordEnrichment — the gated enrichment-log append (plan W3-4, spec B6):
 * an attributed record of out-of-band learning. Never graded evidence; the
 * report side (spec C5, wave 4) renders it as its own credit section and
 * excuses pacing with it.
 */
import { ValidationError } from '#domains/core/errors/index.mjs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class RecordEnrichment {
  #log; #teacherGate; #clock; #idGen; #logger;

  constructor({ log, teacherGate, clock = () => new Date(), idGen = () => `enr_${Math.random().toString(36).slice(2, 10)}`, logger = console } = {}) {
    if (!log) throw new Error('RecordEnrichment requires log');
    if (!teacherGate) throw new Error('RecordEnrichment requires teacherGate');
    this.#log = log;
    this.#teacherGate = teacherGate;
    this.#clock = clock;
    this.#idGen = idGen;
    this.#logger = logger;
  }

  async execute({
    recordedBy = null, pin = null, learnerIds = [], from, to = null,
    title, subjectIds = [], note = null, kind = 'enrichment',
  } = {}) {
    this.#teacherGate.assert({ userId: recordedBy, pin, action: 'enrichment.record', context: { title, kind } });
    // Two entry kinds share the calendar-exception machinery (advocacy B5):
    // 'enrichment' excuses pacing AND prints as credit; 'absence' (sick week,
    // non-educational travel) excuses pacing and NEVER appears as credit —
    // a flu must not be falsified as a museum trip to stop the delinquency
    // math.
    if (kind !== 'enrichment' && kind !== 'absence') throw new ValidationError("kind must be 'enrichment' or 'absence'");
    if (typeof title !== 'string' || !title.trim()) throw new ValidationError('title is required');
    if (!Array.isArray(learnerIds) || learnerIds.length === 0) throw new ValidationError('at least one learner is required');
    if (typeof from !== 'string' || !DATE_RE.test(from)) throw new ValidationError('from must be YYYY-MM-DD');
    const end = to ?? from;
    if (typeof end !== 'string' || !DATE_RE.test(end) || end < from) throw new ValidationError('to must be YYYY-MM-DD, not before from');
    const entry = {
      id: this.#idGen(),
      at: this.#clock().toISOString(),
      kind,
      recordedBy,
      learnerIds: [...learnerIds],
      from,
      to: end,
      title: title.trim(),
      subjectIds: Array.isArray(subjectIds) ? [...subjectIds] : [],
      ...(note ? { note: String(note) } : {}),
    };
    await this.#log.append(entry);
    // Enrichment excuses pacing lateness, so a term-end review of "why was
    // this milestone not late" needs the credit that answered it.
    this.#logger.info?.('school.enrichment.recorded', {
      entryId: entry.id, recordedBy, learnerIds: entry.learnerIds, from, to: end, kind,
    });
    return { entry };
  }
}
