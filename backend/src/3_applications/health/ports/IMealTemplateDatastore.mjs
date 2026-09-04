/**
 * Persistence port for meal templates and the dismissal ledger.
 *
 * Two collections in one place because they are two halves of one decision:
 * a dismissed proposal must never reappear, and the only durable record of
 * that refusal is a key the miner is handed back on its next run.
 */
export class IMealTemplateDatastore {
  async list(userId) { throw new Error('IMealTemplateDatastore.list must be implemented'); }
  async getById(id, userId) { throw new Error('IMealTemplateDatastore.getById must be implemented'); }
  async save(template, userId) { throw new Error('IMealTemplateDatastore.save must be implemented'); }
  async remove(id, userId) { throw new Error('IMealTemplateDatastore.remove must be implemented'); }
  async listDismissedKeys(userId) { throw new Error('IMealTemplateDatastore.listDismissedKeys must be implemented'); }
  async addDismissedKey(key, userId) { throw new Error('IMealTemplateDatastore.addDismissedKey must be implemented'); }
}
export default IMealTemplateDatastore;
