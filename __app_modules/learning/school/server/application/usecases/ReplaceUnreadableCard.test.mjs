// @vitest-environment node
/**
 * ReplaceUnreadableCard — a card the reader cannot read the same way twice is
 * replaced like a lost one (`ReplaceLostAnswerSheet`: only live work reprints,
 * graded work stays as evidence), then retired so it is never reused.
 */
import { describe, it, expect, vi } from 'vitest';
import { ReplaceUnreadableCard } from "./ReplaceUnreadableCard.mjs";

const CARD = '4113279';

function build(lost) {
  const replaceLostAnswerSheet = { execute: vi.fn(async () => lost) };
  const allocationStore = { retireCard: vi.fn(async () => []) };
  const logger = { info: vi.fn(), warn: vi.fn() };
  const useCase = new ReplaceUnreadableCard({ replaceLostAnswerSheet, allocationStore, logger });
  return { replaceLostAnswerSheet, allocationStore, logger, useCase };
}

describe('ReplaceUnreadableCard', () => {
  it('live work moves to a fresh card, then the old card is retired', async () => {
    const replacements = [{ oldRecordId: 'live@7-11', newRecordId: 'new@1-5', documentId: 'civ/ws', rowRange: { start: 1, end: 5 } }];
    const h = build({ status: 'replaced', cardId: CARD, replacementCardId: '7654321', replacements });

    const result = await h.useCase.execute({ cardId: CARD, reason: 'omr_alignment_unconfirmed' });

    expect(h.replaceLostAnswerSheet.execute).toHaveBeenCalledWith({
      cardId: CARD, reportedBy: 'system:unreadable-card', authorized: true,
    });
    expect(h.allocationStore.retireCard).toHaveBeenCalledWith({
      cardId: CARD, reason: 'omr_alignment_unconfirmed', retiredBy: 'system:unreadable-card',
    });
    expect(result).toEqual({ cardId: CARD, retired: true, replacementCardId: '7654321', replacements });
    expect(h.logger.info).toHaveBeenCalledWith('school.answer-sheet.unreadable-replaced', {
      cardId: CARD, replacementCardId: '7654321', reprinted: 1, reason: 'omr_alignment_unconfirmed',
    });
  });

  it('a card with nothing left to reprint is still retired', async () => {
    const h = build({ status: 'already_settled', cardId: CARD, replacementCardId: null, replacements: [] });
    const result = await h.useCase.execute({ cardId: CARD, reason: 'omr_alignment_unconfirmed' });
    expect(result).toMatchObject({ retired: true, replacements: [] });
    expect(h.allocationStore.retireCard).toHaveBeenCalledTimes(1);
  });

  it('a printer failure throws and leaves the card in service', async () => {
    const h = build({ status: 'print_failed', cardId: CARD, replacementCardId: null, replacements: [] });
    await expect(h.useCase.execute({ cardId: CARD, reason: 'omr_alignment_unconfirmed' })).rejects.toThrow(/print/i);
    expect(h.allocationStore.retireCard).not.toHaveBeenCalled();
  });
});
