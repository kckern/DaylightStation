/**
 * ResolvePersonalCard — the scan that starts everything (spec §6.1).
 *
 * A personal card never expires and is reusable forever. Whatever state a child
 * is in — nothing started, halfway through a video, holding a sheet they cannot
 * find, stuck on something a grown-up has to mark — scanning their card prints a
 * current list. It is the recovery path for every other failure in the system,
 * which is exactly why it carries no expiry and no preconditions.
 *
 * It builds the agenda, prints it, and hands back what happened. If the printer
 * refuses, that is reported rather than swallowed: the one thing worse than no
 * agenda is a child standing at a printer believing one is coming.
 */
import { noticeDocument } from '#domains/school/documents/receipts.mjs';

export class ResolvePersonalCard {
  #buildAgenda; #receipts; #roster; #logger;

  /**
   * @param {object} deps
   * @param {import('./BuildAgenda.mjs').BuildAgenda} deps.buildAgenda
   * @param {{print: (document: object) => Promise<{printed: boolean}>}} deps.receipts
   *   the receipt printing collaborator (render + thermal transport)
   * @param {{displayName: (learnerId: string) => string|null}} [deps.roster]
   * @param {object} [deps.logger]
   */
  constructor({ buildAgenda, receipts, roster = null, logger = console } = {}) {
    if (!buildAgenda || !receipts) throw new Error('ResolvePersonalCard requires buildAgenda and receipts');
    this.#buildAgenda = buildAgenda;
    this.#receipts = receipts;
    this.#roster = roster;
    this.#logger = logger;
  }

  /**
   * @param {object} args
   * @param {string} args.learnerId - resolved from the card's registry record
   * @returns {Promise<{ status: 'agenda_printed'|'print_failed'|'unknown_learner',
   *                     learnerId: string|null, offers: object[], printed: boolean,
   *                     message: string }>}
   */
  async execute({ learnerId } = {}) {
    if (typeof learnerId !== 'string' || !learnerId.trim()) {
      const printed = await this.#receipts.print(noticeDocument({
        id: 'card-unknown',
        headline: 'Whose card is this?',
        lines: ['We could not tell who scanned. Ask a grown-up to set up your card.'],
      }));
      return { status: 'unknown_learner', learnerId: null, offers: [], printed: printed.printed, message: 'We do not know that card.' };
    }

    const learnerName = this.#roster?.displayName?.(learnerId) ?? null;
    const agenda = await this.#buildAgenda.execute({ learnerId, learnerName });
    const outcome = await this.#receipts.print(agenda.document);

    if (!outcome.printed) {
      this.#logger.warn?.('school.card.print-failed', { learnerId, offers: agenda.offers.length });
      return {
        status: 'print_failed',
        learnerId,
        offers: agenda.offers,
        printed: false,
        message: 'Your list is ready but the printer did not answer. Try scanning again.',
      };
    }

    this.#logger.info?.('school.card.agenda-printed', {
      learnerId, offers: agenda.offers.length, created: agenda.createdSessions.length,
    });
    return {
      status: 'agenda_printed',
      learnerId,
      offers: agenda.offers,
      printed: true,
      message: 'Printing your list.',
    };
  }
}

export default ResolvePersonalCard;
