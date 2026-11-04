/**
 * ReplaceUnreadableCard — the paper is the problem, so the paper is replaced.
 *
 * `ResolveCardScan` refuses a read whose old rows sit shifted against what the
 * card said before (`omrAlignment`), and a refused read fed again unchanged is
 * accepted as the child's real marks. A card that comes back DIFFERENT every
 * time can never be confirmed that way, and before this use case it was
 * refused forever while the child's unfinished work sat on it (failure policy:
 * a machine technicality never leaves a child with nothing to do).
 *
 * After `UNSALVABLE_REFUSALS` such reads the card is handled like a lost one:
 * `ReplaceLostAnswerSheet` reprints every live sheet on a fresh card (printing
 * before it supersedes, so a printer fault never strands the only copy) and
 * leaves graded work as evidence. Then the card is retired, so it is never
 * reused and a later feed of it gets the "this card was replaced" answer
 * rather than another refusal.
 */
const RETIRED_BY = 'system:unreadable-card';

export class ReplaceUnreadableCard {
  #replaceLostAnswerSheet; #allocationStore; #logger;

  /**
   * @param {object} deps
   * @param {{execute: Function}} deps.replaceLostAnswerSheet - `ReplaceLostAnswerSheet`
   * @param {{retireCard: Function}} deps.allocationStore
   * @param {object} [deps.logger]
   */
  constructor({ replaceLostAnswerSheet, allocationStore, logger = console } = {}) {
    if (!replaceLostAnswerSheet?.execute || !allocationStore?.retireCard) {
      throw new Error('ReplaceUnreadableCard requires replaceLostAnswerSheet and allocationStore.retireCard');
    }
    this.#replaceLostAnswerSheet = replaceLostAnswerSheet;
    this.#allocationStore = allocationStore;
    this.#logger = logger;
  }

  /**
   * @param {{cardId: string, reason: string}} args
   * @returns {Promise<{cardId: string, retired: boolean, replacementCardId: string|null, replacements: object[]}>}
   *   `retired: false` when nothing live was left to reprint (the card stays in service)
   * @throws when the reprint did not finish — the card stays in service, so the
   *   child still holds a usable copy and the caller can say it could not read it
   */
  async execute({ cardId, reason } = {}) {
    const lost = await this.#replaceLostAnswerSheet.execute({ cardId, reportedBy: RETIRED_BY, authorized: true });
    if (lost?.status !== 'replaced' && lost?.status !== 'already_settled') {
      throw new Error(`unreadable card ${cardId} was not reprinted: ${lost?.status ?? 'no result'}`);
    }
    const replacements = lost.replacements ?? [];
    // Nothing live to reprint: retiring would only close the card's other
    // paths (a failed sheet still correctable on it), so it stays in service
    // and the caller sends the child to a grown-up instead.
    if (lost.status === 'already_settled') {
      this.#logger.warn?.('school.answer-sheet.unreadable-kept', { cardId, reason });
      return { cardId, retired: false, replacementCardId: null, replacements: [] };
    }
    await this.#allocationStore.retireCard({ cardId, reason, retiredBy: RETIRED_BY });
    this.#logger.info?.('school.answer-sheet.unreadable-replaced', {
      cardId, replacementCardId: lost.replacementCardId ?? null, reprinted: replacements.length, reason,
    });
    return { cardId, retired: true, replacementCardId: lost.replacementCardId ?? null, replacements };
  }
}

export default ReplaceUnreadableCard;
