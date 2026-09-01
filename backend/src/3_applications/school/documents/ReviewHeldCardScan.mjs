import { ValidationError } from '#domains/core/errors/index.mjs';
import { answerSheetIdenticon } from '#domains/school/documents/answerSheetIdentity.mjs';

const ACTIONS = new Set(['confirm', 'reassign', 'redo']);

/** Teacher-only recovery for scans stopped by answer-sheet identity preflight. */
export class ReviewHeldCardScan {
  #held; #allocations; #documents; #resolver; #teacherGate; #recorder; #clock; #logger;
  #resolutionChain = Promise.resolve();

  constructor({
    heldScanStore, allocationStore, repository, resolveCardScan, teacherGate,
    outcomeRecorder = null, clock = () => new Date(), logger = console,
  } = {}) {
    if (!heldScanStore || !allocationStore || !repository || !resolveCardScan || !teacherGate) {
      throw new Error('ReviewHeldCardScan requires heldScanStore, allocationStore, repository, resolveCardScan, and teacherGate');
    }
    this.#held = heldScanStore;
    this.#allocations = allocationStore;
    this.#documents = repository;
    this.#resolver = resolveCardScan;
    this.#teacherGate = teacherGate;
    this.#recorder = outcomeRecorder;
    this.#clock = clock;
    this.#logger = logger;
  }

  bindOutcomeRecorder(recorder) {
    if (!recorder || typeof recorder.execute !== 'function') {
      throw new Error('ReviewHeldCardScan outcome recorder must expose execute()');
    }
    this.#recorder = recorder;
  }

  async list({ reviewerId, pin } = {}) {
    this.#assert(reviewerId, pin, 'answer-sheet-review.list');
    return Promise.all((await this.#held.listHeld()).map((record) => this.#present(record)));
  }

  async inspect({ heldScanId, reviewerId, pin } = {}) {
    this.#assert(reviewerId, pin, 'answer-sheet-review.inspect', { heldScanId });
    return this.#present(await this.#held.get(heldScanId));
  }

  async resolve(args = {}) {
    // Serialize the whole recovery transaction, not only the final YAML
    // append. Two browser taps with different actions must never both replay
    // grades and race to become the one terminal review.
    const operation = this.#resolutionChain.then(() => this.#resolve(args));
    this.#resolutionChain = operation.catch(() => {});
    return operation;
  }

  async #resolve({
    heldScanId, action, targetRecordId = null, reviewerId, pin, idempotencyKey,
  } = {}) {
    this.#assert(reviewerId, pin, 'answer-sheet-review.resolve', { heldScanId, action });
    if (!ACTIONS.has(action)) throw new ValidationError('action must be confirm|reassign|redo');
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
      throw new ValidationError('idempotencyKey is required');
    }
    const started = this.#clock();
    const held = await this.#held.get(heldScanId);
    const prior = held.reviews.find((review) => review.idempotencyKey === idempotencyKey);
    if (prior) return { review: prior, duplicate: true };
    if (held.reviews.some((review) => review.terminal === true)) {
      const error = new Error(`held scan '${heldScanId}' is already resolved`);
      error.code = 'HELD_SCAN_ALREADY_RESOLVED';
      throw error;
    }
    const evidence = held.evidence;
    const at = started.toISOString();

    if (action === 'redo') {
      const sourceRows = answerWindow(evidence.rawRows);
      let quarantine = null;
      if (sourceRows) {
        quarantine = await this.#allocations.quarantineRows({
          cardId: evidence.rawCardId, rows: sourceRows, heldScanId,
          reason: 'redo-held-wrong-sheet-scan', reviewerId, at,
        });
      }
      const appended = await this.#held.appendReview({
        heldScanId, idempotencyKey,
        review: { action, reviewerId, terminal: true, gradeCreated: false, quarantine, at },
      });
      this.#logResolved({ heldScanId, action, reviewerId, started, gradeCreated: false });
      return appended;
    }

    if (!this.#recorder || typeof this.#recorder.execute !== 'function') {
      throw new ValidationError('answer-sheet review recording is not configured');
    }

    if (typeof targetRecordId !== 'string' || !targetRecordId) {
      throw new ValidationError(`${action} requires targetRecordId`);
    }
    const candidate = evidence.candidateWorksheets.find((entry) => entry.recordId === targetRecordId);
    if (!candidate) throw new ValidationError('targetRecordId is not a candidate for this held scan');
    const targetRecord = (await this.#allocations.findByCard(candidate.cardId))
      .find((entry) => entry.recordId === targetRecordId);
    if (!targetRecord) throw new ValidationError('target allocation no longer exists');
    if (targetRecord.learnerId !== evidence.learnerId) throw new ValidationError('target learner does not match held scan');

    let replayAnswers = structuredClone(evidence.decodedAnswers);
    let mapping = canonicalSameRowMapping(evidence.rawRows);
    let quarantine = null;
    let provenanceKind = 'manual-held-scan-confirmation';
    if (action === 'confirm') {
      if (candidate.cardId !== evidence.rawCardId) {
        throw new ValidationError('confirm must select an allocation on the scanned answer sheet');
      }
    } else {
      if (candidate.cardId === evidence.rawCardId) {
        throw new ValidationError('reassign must target a different answer sheet');
      }
      const sourceRows = answerWindow(evidence.rawRows);
      if (!sourceRows) throw new ValidationError('reassignment requires a non-empty source window');
      assertReassignmentCompatible({ sourceRows, targetRecord, evidence });
      ({ answers: replayAnswers, mapping } = reassignOrdinally({
        rawRows: evidence.rawRows, targetRange: targetRecord.rowRange,
      }));
      provenanceKind = 'manual-wrong-card-reassignment';
      quarantine = await this.#allocations.quarantineRows({
        cardId: evidence.rawCardId, rows: sourceRows, heldScanId,
        reason: provenanceKind, reviewerId, at,
      });
    }

    const provenance = {
      kind: provenanceKind,
      heldScanId,
      source: { cardId: evidence.rawCardId, rows: answerWindow(evidence.rawRows) },
      target: { cardId: targetRecord.cardId, recordId: targetRecord.recordId, rows: targetRecord.rowRange },
      reviewerId,
      reviewedAt: at,
      mapping,
    };
    const outcome = await this.#resolver.execute({
      testId: targetRecord.cardId,
      answers: replayAnswers,
      identityReview: { heldScanId, action, targetRecordId },
    });
    const card = outcome.results?.find((entry) => entry.recordId === targetRecordId);
    if (!card || card.error) throw new ValidationError('held scan replay did not produce a gradeable target result');
    card.manualReviewProvenance = provenance;
    const recorded = await this.#recorder.execute({ testId: targetRecord.cardId, card });
    const appended = await this.#held.appendReview({
      heldScanId, idempotencyKey,
      review: {
        action, reviewerId, terminal: true, gradeCreated: recorded.recorded === true,
        targetRecordId, provenance, quarantine, replay: { outcome: card, recorded }, at,
      },
    });
    this.#logResolved({ heldScanId, action, reviewerId, started, gradeCreated: recorded.recorded === true });
    return appended;
  }

  async clearQuarantine({ cardId, quarantineId, method, reviewerId, pin } = {}) {
    this.#assert(reviewerId, pin, 'answer-sheet-review.clear-quarantine', { cardId, quarantineId, method });
    return this.#allocations.clearQuarantine({ cardId, quarantineId, reviewerId, method });
  }

  #assert(userId, pin, action, context = {}) {
    this.#teacherGate.assert({ userId, pin, action, context });
  }

  async #present(record) {
    const candidates = await Promise.all(record.evidence.candidateWorksheets.map(async (candidate) => {
      let title = candidate.documentId;
      try {
        const document = await this.#documents.getPublished(candidate.documentId, candidate.rev);
        title = document?.title ?? title;
      } catch { /* retain immutable document id when a legacy artifact is missing */ }
      return {
        ...candidate,
        title,
        identicon: answerSheetIdenticon(candidate.cardId, candidate.identiconVersion ?? undefined),
      };
    }));
    return { ...record, evidence: { ...record.evidence, candidateWorksheets: candidates } };
  }

  #logResolved({ heldScanId, action, reviewerId, started, gradeCreated }) {
    this.#logger.info?.(`school.scan.identity-${action}`, {
      heldScanId, reviewerId, gradeCreated,
      reviewLatencyMs: Math.max(0, this.#clock().getTime() - started.getTime()),
    });
  }
}

function answerWindow(rawRows) {
  const rows = (rawRows ?? []).map((entry) => entry.row).filter(Number.isInteger).sort((a, b) => a - b);
  return rows.length ? { start: rows[0], end: rows.at(-1) } : null;
}

function canonicalSameRowMapping(rawRows) {
  return (rawRows ?? []).map((entry) => ({ fromRow: entry.row, toRow: entry.row, marks: [...entry.marks] }));
}

function assertReassignmentCompatible({ sourceRows, targetRecord, evidence }) {
  const sourceCount = sourceRows.end - sourceRows.start + 1;
  const targetCount = targetRecord.rowRange.end - targetRecord.rowRange.start + 1;
  if (sourceCount !== targetCount) throw new ValidationError('source and target row counts differ');
  if (!Array.isArray(targetRecord.rowItems) || targetRecord.rowItems.length !== targetCount
      || targetRecord.rowItems.some((item, index) => item.row !== targetRecord.rowRange.start + index)) {
    throw new ValidationError('target row mapping is incomplete');
  }
  if (targetRecord.rowItems.some((item) => item.itemType === 'companion_code')) {
    throw new ValidationError('companion-gated worksheets cannot be reassigned');
  }
  const sourceCandidates = evidence.candidateWorksheets.filter((candidate) => (
    candidate.cardId === evidence.rawCardId
    && candidate.rowRange.start <= sourceRows.start
    && candidate.rowRange.end >= sourceRows.end
  ));
  if (sourceCandidates.length !== 1) {
    throw new ValidationError('source row ownership is not unambiguous');
  }
  const sourceCandidate = sourceCandidates[0];
  const sourceTypes = sourceCandidate.itemTypes;
  if (!Array.isArray(sourceTypes)) {
    throw new ValidationError('source row mapping is incomplete');
  }
  const offset = sourceRows.start - sourceCandidate.rowRange.start;
  const windowTypes = sourceTypes.slice(offset, offset + sourceCount);
  const targetTypes = targetRecord.rowItems.map((item) => item.itemType);
  if (windowTypes.length !== sourceCount || windowTypes.join('|') !== targetTypes.join('|')) {
    throw new ValidationError('source and target item types differ');
  }
  if (windowTypes.includes('companion_code')) {
    throw new ValidationError('companion-gated worksheets cannot be reassigned');
  }
}

function reassignOrdinally({ rawRows, targetRange }) {
  const sourceRange = answerWindow(rawRows);
  const marksByRow = new Map(rawRows.map((entry) => [entry.row, [...entry.marks]]));
  const answers = {};
  const mapping = [];
  for (let offset = 0; offset <= sourceRange.end - sourceRange.start; offset += 1) {
    const fromRow = sourceRange.start + offset;
    const toRow = targetRange.start + offset;
    const marks = marksByRow.get(fromRow) ?? null;
    if (marks) answers[toRow] = marks.length === 1 ? marks[0] : marks;
    mapping.push({ fromRow, toRow, marks });
  }
  return { answers, mapping };
}

export default ReviewHeldCardScan;
