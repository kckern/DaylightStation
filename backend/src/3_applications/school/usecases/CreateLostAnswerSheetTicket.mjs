import { mintToken } from '#domains/school/sessions/tokens.mjs';
import { noticeDocument } from '#domains/school/documents/receipts.mjs';

const DEFAULT_TTL_MINUTES = 15;

/** Creates a short-lived, one-card recovery QR after teacher authorization. */
export class CreateLostAnswerSheetTicket {
  #tokens; #teacherGate; #clock; #rng; #ttlMinutes;

  constructor({ tokens, teacherGate, clock = () => new Date(), rng = Math.random, ttlMinutes = DEFAULT_TTL_MINUTES } = {}) {
    if (!tokens || !teacherGate) throw new Error('CreateLostAnswerSheetTicket requires tokens and teacherGate');
    this.#tokens = tokens;
    this.#teacherGate = teacherGate;
    this.#clock = clock;
    this.#rng = rng;
    this.#ttlMinutes = ttlMinutes;
  }

  async execute({ cardId, requestedBy, pin = null } = {}) {
    if (!/^\d{7}$/.test(cardId ?? '')) throw new Error('cardId must be 7 digits');
    this.#teacherGate.assert({
      userId: requestedBy, pin, action: 'answer-sheet.lost-ticket', context: { cardId },
    });
    const now = this.#clock();
    const record = mintToken({
      tokenClass: 'answer_sheet_lost',
      subject: { cardId, authorizedBy: requestedBy },
      at: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.#ttlMinutes * 60_000).toISOString(),
      rng: this.#rng,
    });
    await this.#tokens.put(record);
    const document = noticeDocument({
      id: `replace-lost-${cardId}`,
      headline: 'Lost answer sheet',
      lines: [`Student No. ${cardId}`, 'Scan once to print a replacement answer sheet.'],
      actions: [{ token: record.token, label: 'Replace lost answer sheet' }],
    });
    return {
      status: 'issued', cardId, code: record.token, expiresAt: record.expiresAt,
      label: 'Replace lost answer sheet', document,
    };
  }
}

export default CreateLostAnswerSheetTicket;
