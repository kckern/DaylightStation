/**
 * GetLearnerRecord — one child's complete communications record, merged
 * (admin advocacy #14): notes, review feedback, attestations, enrichment,
 * their own asks (quiz requests / retakes / flags), and print requests were
 * six surfaces nothing joined — "show me everything about this child" meant
 * reading YAML off the volume.
 *
 * Read-only composition, newest first, each row tagged with its source
 * channel. Every store is optional and degrades to absent — a household that
 * never configured printing still gets the rest of the record.
 */
export class GetLearnerRecord {
  #teacherNotes; #reviewQueue; #attestations; #enrichment; #quizRequests; #printRequests; #logger;

  constructor({
    teacherNotes = null, reviewQueue = null, attestations = null,
    enrichment = null, quizRequests = null, printRequests = null, logger = console,
  } = {}) {
    this.#teacherNotes = teacherNotes;
    this.#reviewQueue = reviewQueue;
    this.#attestations = attestations;
    this.#enrichment = enrichment;
    this.#quizRequests = quizRequests;
    this.#printRequests = printRequests;
    this.#logger = logger;
  }

  async execute({ learnerId, limit = 200 } = {}) {
    if (typeof learnerId !== 'string' || !learnerId.trim()) throw new Error('GetLearnerRecord requires learnerId');
    const rows = [];
    const add = (channel, at, payload) => rows.push({ channel, at: at ?? null, ...payload });

    try {
      (this.#teacherNotes?.list({ learnerId }) ?? []).forEach((n) => add('note', n.at, { from: n.from ?? null, note: n.note ?? null }));
    } catch (err) { this.#logger.warn?.('school.learner-record.notes-failed', { learnerId, error: err?.message }); }

    try {
      const pending = this.#reviewQueue ? await this.#reviewQueue.listForLearner?.(learnerId) ?? [] : [];
      pending.forEach((i) => add('review', i.gradedAt ?? i.enqueuedAt ?? null, {
        itemId: i.itemId ?? null, verdict: i.verdict ?? null, gradedBy: i.gradedBy ?? null, note: i.note ?? null,
      }));
    } catch (err) { this.#logger.warn?.('school.learner-record.review-failed', { learnerId, error: err?.message }); }

    try {
      (this.#attestations?.list({ learnerId }) ?? []).forEach((a) => add('attestation', a.at, {
        unitId: a.unitId ?? null, attestedBy: a.attestedBy ?? null, reason: a.reason ?? null,
      }));
    } catch (err) { this.#logger.warn?.('school.learner-record.attestations-failed', { learnerId, error: err?.message }); }

    try {
      (this.#enrichment?.list({ learnerId }) ?? []).forEach((e) => add('enrichment', e.from ?? e.at, {
        title: e.title ?? null, recordedBy: e.recordedBy ?? null,
      }));
    } catch (err) { this.#logger.warn?.('school.learner-record.enrichment-failed', { learnerId, error: err?.message }); }

    try {
      (this.#quizRequests?.() ?? []).filter((r) => r.userId === learnerId).forEach((r) => add(r.kind ?? 'quiz-request', r.at, {
        unitId: r.unitId ?? null, bankId: r.bankId ?? null, title: r.unitTitle ?? null, note: r.note ?? null,
      }));
    } catch (err) { this.#logger.warn?.('school.learner-record.requests-failed', { learnerId, error: err?.message }); }

    try {
      (this.#printRequests?.(learnerId) ?? []).forEach((r) => add('print', r.at, {
        label: r.label ?? null, status: r.status ?? null, deniedBy: r.deniedBy ?? null,
      }));
    } catch (err) { this.#logger.warn?.('school.learner-record.print-failed', { learnerId, error: err?.message }); }

    rows.sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')));
    return { learnerId, entries: rows.slice(0, limit) };
  }
}

export default GetLearnerRecord;
