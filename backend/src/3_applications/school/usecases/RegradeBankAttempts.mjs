/**
 * RegradeBankAttempts — the "we discovered a systematic grading bug three
 * weeks later" story (admin advocacy #5). Until now the only correction path
 * was hand-editing evidence and re-freezing whole periods; nothing could
 * re-run grading over what was actually recorded.
 *
 * Re-runs the ONE grading engine (`gradeAnswer`, the same function every
 * screen answer went through) over recorded attempts for a bank in a date
 * range, against the bank's CURRENT content. Where the verdict changes, it
 * appends a corrective attempt with full provenance — the original row is
 * never edited (append-only forever), the correction is itself a record:
 *   { …attempt, correct: <new>, bankRev: <current>,
 *     provenance: { kind: 'regrade', of: <original id>, by, reason } }
 *
 * DRY RUN BY DEFAULT. Gate-checked, reason required (a regrade rewrites what
 * a child's history MEANS — it has an author and a why). Self-graded
 * flashcard rows are skipped: there is nothing to re-run, the child's own
 * judgment was the grade. Report cards are NOT re-frozen here — the report
 * names the affected sessions so the teacher can supersede deliberately.
 */
import { createHash } from 'node:crypto';
import { gradeAnswer, bankContentRev } from '#domains/school/index.mjs';
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { reduceSession } from '#domains/school/sessions/sessionEvents.mjs';

export class RegradeBankAttempts {
  #datastore; #bankReader; #teacherGate; #learnerDirectory; #sessions; #worksheets; #sessionCorrection; #clock; #logger;

  constructor({ datastore, bankReader, teacherGate, learnerDirectory, sessions = null,
    worksheetInstances = null, sessionCorrection = null, clock = () => new Date(), logger = console } = {}) {
    if (!datastore) throw new Error('RegradeBankAttempts requires datastore');
    if (!bankReader) throw new Error('RegradeBankAttempts requires bankReader');
    if (!teacherGate) throw new Error('RegradeBankAttempts requires teacherGate');
    if (!learnerDirectory) throw new Error('RegradeBankAttempts requires learnerDirectory');
    this.#datastore = datastore;
    this.#bankReader = bankReader;
    this.#teacherGate = teacherGate;
    this.#learnerDirectory = learnerDirectory;
    this.#sessions = sessions;
    this.#worksheets = worksheetInstances;
    this.#sessionCorrection = sessionCorrection;
    this.#clock = clock;
    this.#logger = logger;
  }

  async execute({ bankId, fromDay, toDay, reason, regradedBy = null, pin = null, apply = false } = {}) {
    this.#teacherGate.assert({ userId: regradedBy, pin,
      action: apply === true ? 'attempts.regrade' : 'attempts.regrade.preview', context: { bankId } });
    if (typeof reason !== 'string' || !reason.trim()) {
      throw new ValidationError('a reason is required — a regrade rewrites what recorded history means');
    }
    const throughDay = toDay ?? this.#clock().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDay ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(throughDay)) {
      throw new ValidationError('fromDay and toDay must be YYYY-MM-DD');
    }
    const bank = this.#bankReader.getBank(bankId);
    if (!bank) throw new EntityNotFoundError('bank', bankId);
    const items = new Map(bank.items.map((i) => [i.id, i]));
    const currentRev = bankContentRev(bank);

    const changes = [];
    let checked = 0;
    let alreadyCorrected = 0;
    const today = this.#clock().toISOString().slice(0, 10);
    const learners = await this.#learnerDirectory.listLearners();
    for (const learner of learners) {
      const attempts = this.#datastore.readAttemptsInRange(learner.id, fromDay, throughDay) ?? [];
      // Idempotency (M8 fix 3): corrective rows carry `at` = APPLY time, which
      // lands outside the scanned window — so re-running used to re-append
      // every correction. Scan forward to today for existing corrections and
      // skip their targets.
      const corrected = new Set(
        (this.#datastore.readAttemptsInRange(learner.id, fromDay, today) ?? [])
          .filter((a) => a.provenance?.kind === 'regrade')
          .map((a) => a.provenance.of),
      );
      for (const attempt of attempts) {
        if (attempt.bankId !== bankId) continue;
        if (attempt.given === null || attempt.given === undefined) continue; // self-graded: nothing to re-run
        if (attempt.provenance?.kind === 'regrade') continue; // never regrade a correction
        if (corrected.has(attempt.id)) { alreadyCorrected += 1; continue; } // already amended — idempotent re-run
        const item = items.get(attempt.itemId);
        if (!item) continue; // item re-cut out of the bank — visible via bankRev drift, not regradeable
        checked += 1;
        const { correct } = gradeAnswer(item, attempt.given);
        if (correct === attempt.correct) continue;
        changes.push({
          learnerId: learner.id,
          attemptId: attempt.id,
          sessionId: attempt.sessionId ?? null,
          itemId: attempt.itemId,
          was: attempt.correct,
          now: correct,
          original: attempt,
        });
      }
    }

    let sessionCorrections = [];
    if (apply) {
      const at = this.#clock().toISOString();
      for (const change of changes) {
        this.#datastore.appendAttempt(change.learnerId, {
          ...change.original,
          id: `att_rg_${change.attemptId}`,
          at,
          correct: change.now,
          bankRev: currentRev,
          provenance: { kind: 'regrade', of: change.attemptId, by: regradedBy, reason: reason.trim() },
        });
      }
      this.#logger.info?.('school.attempts.regraded', {
        bankId, fromDay, toDay: throughDay, regradedBy, checked, changed: changes.length,
      });
      // Evidence corrections become grade corrections only when the complete,
      // immutable graded roster is available.  A partial guess would be worse
      // than an unchanged grade: it could rewrite a learner's result from a
      // subset of the questions they actually received.
      sessionCorrections = await this.#reconcileSessions({ changes, bankId, currentRev, reason: reason.trim(), regradedBy, pin });
    }

    const sessionsAffected = [...new Set(changes.map((c) => c.sessionId).filter(Boolean))].sort();
    return {
      bankId,
      fromDay,
      toDay: throughDay,
      applied: Boolean(apply),
      checked,
      alreadyCorrected,
      changed: changes.map(({ original, ...rest }) => rest),
      sessionsAffected,
      sessionCorrections,
    };
  }

  async #reconcileSessions({ changes, bankId, currentRev, reason, regradedBy, pin }) {
    if (!this.#sessions || typeof this.#sessionCorrection !== 'function') return [];
    const grouped = new Map();
    for (const change of changes) {
      if (!change.sessionId) continue;
      const key = `${change.learnerId}\u0000${change.sessionId}`;
      if (!grouped.has(key)) grouped.set(key, { learnerId: change.learnerId, sessionId: change.sessionId });
    }
    const results = [];
    for (const { learnerId, sessionId } of grouped.values()) {
      try {
        const events = await this.#sessions.readEvents(sessionId);
        const state = reduceSession(events);
        const activeManual = [...(state.gradeAdjustments ?? [])].reverse()
          .find((row) => !row.retracted && !String(row.adjustmentId).startsWith('regrade_'));
        if (!state.machineGrade?.attemptIds?.length || activeManual) {
          results.push({ sessionId, status: activeManual ? 'skipped_manual_adjustment' : 'skipped_no_machine_roster' });
          continue;
        }
        const originals = new Map();
        const corrections = new Map();
        for (const attempt of this.#datastore.readAllAttempts(learnerId) ?? []) {
          if (attempt.provenance?.kind === 'regrade' && attempt.provenance.of) corrections.set(attempt.provenance.of, attempt);
          else originals.set(attempt.id, attempt);
        }
        const marked = state.machineGrade.attemptIds.map((id) => corrections.get(id) ?? originals.get(id));
        const totalCount = state.machineGrade.totalCount ?? marked.length;
        if (marked.length !== totalCount || marked.some((attempt) => !attempt || typeof attempt.correct !== 'boolean')) {
          results.push({ sessionId, status: 'skipped_incomplete_evidence' });
          continue;
        }
        const correctCount = marked.filter((attempt) => attempt.correct).length;
        const missedItemIds = marked.filter((attempt) => !attempt.correct).map((attempt) => attempt.itemId).filter(Boolean);
        const worksheet = await this.#worksheets?.findBySession?.(sessionId) ?? null;
        const roster = worksheet?.itemIds?.length ? worksheet.itemIds : worksheet?.questions?.map((row) => row.itemId).filter(Boolean);
        const byItem = new Map(marked.map((attempt) => [attempt.itemId, attempt]));
        if (roster?.length && (roster.length !== totalCount || roster.some((id) => !byItem.has(id)))) {
          results.push({ sessionId, status: 'skipped_incomplete_worksheet_roster' });
          continue;
        }
        const digest = createHash('sha256').update(JSON.stringify({ bankId, currentRev, sessionId,
          attemptIds: state.machineGrade.attemptIds, correctCount, totalCount })).digest('hex').slice(0, 16);
        const adjustmentId = `regrade_${digest}`;
        const adjusted = await this.#sessionCorrection({ sessionId, adjustmentId,
          percent: Math.round((correctCount / totalCount) * 10000) / 100,
          correctCount, totalCount, missedItemIds,
          ...(roster?.length ? { itemVerdicts: roster.map((itemId) => ({ itemId,
            verdict: byItem.get(itemId).correct ? 'correct' : 'incorrect' })) } : {}),
          reason: `Systematic regrade (${bankId}@${currentRev}): ${reason}`,
          adjustedBy: regradedBy, pin, baseSeq: events.reduce((max, event) => Math.max(max, Number(event.seq) || 0), 0), apply: true });
        results.push({ sessionId, status: adjusted.idempotent ? 'already_corrected' : 'corrected',
          adjustmentId, receiptArtifact: adjusted.receiptArtifact ?? null });
      } catch (error) {
        this.#logger.warn?.('school.attempts.regrade-session-correction-failed', { sessionId, error: error.message });
        results.push({ sessionId, status: 'correction_failed', error: error.message });
      }
    }
    return results;
  }
}

export default RegradeBankAttempts;
