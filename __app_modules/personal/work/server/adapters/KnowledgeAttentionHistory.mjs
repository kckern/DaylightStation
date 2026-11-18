import { IAttentionHistory } from '../application/ports/IAttentionHistory.mjs';
const fields = ['id', 'reservationId', 'day', 'channel', 'flowType', 'questionUnits', 'refKey', 'status', 'createdAt', 'expiresAt', 'deliveredAt', 'botMessageId', 'response'];
/** Reads the public KB owner boundary; cannot open its storage files. */
export class KnowledgeAttentionHistory extends IAttentionHistory {
  #read;
  constructor({
    readHistory
  }) {
    super();
    if (typeof readHistory !== 'function') throw new TypeError('Attention history reader required');
    this.#read = readHistory;
  }
  async read(input) {
    try {
      const h = await this.#read(input);
      if (!h || h.available === false || !['deliveries', 'reservations', 'unansweredInvitations'].every(k => Array.isArray(h[k]))) throw Error('unavailable');
      for (const row of [...h.deliveries, ...h.reservations, ...h.unansweredInvitations]) if (typeof row.id !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.day ?? '') || !Number.isSafeInteger(row.questionUnits) || row.questionUnits < 0 || !['morning', 'review', 'housekeeping'].includes(row.channel) || !['delivered', 'prepared', 'quarantined'].includes(row.status) || row.status === 'delivered' && !Number.isFinite(row.deliveredAt)) throw Error('invalid_history');
      const copy = rows => rows.map(row => Object.fromEntries(fields.filter(k => Object.hasOwn(row, k)).map(k => [k, structuredClone(row[k])])));
      return {
        available: true,
        maxQuestionUnits: Number.isInteger(h.maxQuestionUnits) && h.maxQuestionUnits >= 0 ? Math.min(2, h.maxQuestionUnits) : 2,
        deliveries: copy(h.deliveries),
        reservations: copy(h.reservations),
        unansweredInvitations: copy(h.unansweredInvitations)
      };
    } catch {
      return {
        available: false,
        deliveries: [],
        reservations: [],
        unansweredInvitations: []
      };
    }
  }
}
