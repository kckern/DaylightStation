/**
 * Parent-authorized replacement of a lost physical answer sheet.
 *
 * Only live allocations are reissued. Settled work remains immutable evidence.
 * Each replacement is printed successfully before its old allocation is
 * superseded, so a printer failure never invalidates the learner's only usable
 * copy. A partial printer failure may therefore leave the remaining records on
 * the old card live; repeating the action safely replaces only those records.
 */
export class ReplaceLostAnswerSheet {
  #allocations; #documents; #renderer; #printer; #teacherGate; #clock; #logger;

  constructor({
    allocationStore, printDocuments, renderPrintDocument, printer, teacherGate,
    clock = () => new Date(), logger = console,
  } = {}) {
    if (!allocationStore || !printDocuments || !renderPrintDocument || !printer || !teacherGate) {
      throw new Error('ReplaceLostAnswerSheet requires allocationStore, printDocuments, renderPrintDocument, printer and teacherGate');
    }
    this.#allocations = allocationStore;
    this.#documents = printDocuments;
    this.#renderer = renderPrintDocument;
    this.#printer = printer;
    this.#teacherGate = teacherGate;
    this.#clock = clock;
    this.#logger = logger;
  }

  async execute({ cardId, reportedBy, pin = null, authorized = false } = {}) {
    if (!/^\d{7}$/.test(cardId ?? '')) throw new Error('cardId must be 7 digits');
    if (!authorized) {
      this.#teacherGate.assert({
        userId: reportedBy, pin, action: 'answer-sheet.replace-lost', context: { cardId },
      });
    }

    const records = await this.#allocations.findByCard(cardId);
    const live = records.filter((record) => record.status === 'live');
    if (live.length === 0) {
      return { status: 'already_settled', cardId, replacementCardId: null, replacements: [] };
    }
    const learnerIds = new Set(live.map((record) => record.learnerId).filter(Boolean));
    if (learnerIds.size !== 1) throw new Error('lost answer sheet must have exactly one attributable learner');
    const learnerId = [...learnerIds][0];

    let replacementCardId = null;
    let nextRow = 1;
    const replacements = [];
    for (const oldRecord of live) {
      // eslint-disable-next-line no-await-in-loop
      const document = await this.#documents.getPublished(oldRecord.documentId, oldRecord.rev);
      if (!document) throw new Error(`published document not found: ${oldRecord.documentId}@${oldRecord.rev}`);
      const context = replacementCardId
        ? { cardId: replacementCardId, startRow: nextRow }
        : { freshCard: true, startRow: nextRow };
      Object.assign(context, {
        learnerId,
        learnerName: learnerId,
        sessionId: oldRecord.sessionId,
      });

      let rendered;
      try {
        // eslint-disable-next-line no-await-in-loop
        rendered = await this.#renderer.execute({
          document: { ...document, variant: oldRecord.variant, seed: oldRecord.seed }, context,
        });
        // eslint-disable-next-line no-await-in-loop
        await this.#printer.printPdf(rendered.bytes, {
          jobName: `school-replace-lost-${oldRecord.documentId.replaceAll('/', '-')}`,
          user: learnerId,
          // The replacement sheet is folded the way it was DRAWN: the render
          // reports whether it alternated the 3-hole-punch gutter by page
          // parity (duplex) or fixed it to the left of every page (simplex),
          // and printing the fixed-gutter case double-sided would put facing
          // pages' punch margins on opposite edges of one sheet. `undefined`
          // (the v1 legacy path, which draws no gutter) keeps the adapter's
          // configured default.
          duplex: rendered.duplex ?? undefined,
        });
      } catch (error) {
        if (rendered?.allocation) {
          // eslint-disable-next-line no-await-in-loop
          await this.#allocations.release({
            cardId: rendered.allocation.cardId, rows: rendered.allocation.rowRange,
          }).catch(() => {});
        }
        this.#logger.warn?.('school.answer-sheet.replacement-failed', {
          cardId, replacementCardId, recordId: oldRecord.recordId, error: error.message,
        });
        return {
          status: 'print_failed', cardId, replacementCardId, replacements,
          message: 'The printer did not finish replacing that answer sheet. Try again.',
        };
      }

      replacementCardId = rendered.allocation.cardId;
      nextRow = rendered.allocation.rowRange.end + 1;
      // eslint-disable-next-line no-await-in-loop
      await this.#allocations.markRecordLost({
        cardId,
        recordId: oldRecord.recordId,
        replacementCardId,
        replacementRecordId: rendered.allocation.recordId,
        reportedBy,
        at: this.#clock().toISOString(),
      });
      replacements.push({
        oldRecordId: oldRecord.recordId,
        newRecordId: rendered.allocation.recordId,
        documentId: oldRecord.documentId,
        rowRange: rendered.allocation.rowRange,
      });
    }

    this.#logger.info?.('school.answer-sheet.replaced', {
      cardId, replacementCardId, learnerId, count: replacements.length, reportedBy,
    });
    return {
      status: 'replaced', cardId, replacementCardId, learnerId, replacements,
      message: `A new answer sheet was issued with Student No. ${replacementCardId}.`,
    };
  }
}

export default ReplaceLostAnswerSheet;
