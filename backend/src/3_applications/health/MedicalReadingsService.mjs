//
// Deliberately dumb store of manual medical readings (BP, labs). Validation
// only — no interpretation. value2 exists for BP diastolic.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const invalid = (msg) => {
  const err = new Error(`INVALID_READING: ${msg}`);
  err.code = 'INVALID_READING';
  return err;
};

export class MedicalReadingsService {
  #store; #createId; #logger;

  constructor({ store, createId, logger }) {
    if (!store || typeof createId !== 'function') {
      throw new Error('MedicalReadingsService requires store and createId');
    }
    this.#store = store;
    this.#createId = createId;
    this.#logger = logger || console;
  }

  async add(reading, userId) {
    const { metric, value, value2 = null, unit = '', date, note = '' } = reading || {};
    if (typeof metric !== 'string' || !metric.trim()) throw invalid('metric required');
    if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid('value must be a finite number');
    if (value2 !== null && (typeof value2 !== 'number' || !Number.isFinite(value2))) throw invalid('value2 must be a finite number or null');
    if (typeof date !== 'string' || !DATE_RE.test(date)) throw invalid('date must be YYYY-MM-DD');

    const doc = await this.#store.load(userId);
    const entry = { id: this.#createId(), metric: metric.trim(), value, value2, unit, date, note };
    doc.readings.push(entry);
    await this.#store.save(doc, userId);
    this.#logger.info?.('health.medical.added', { metric: entry.metric, date });
    return entry;
  }

  async listGrouped(userId) {
    const doc = await this.#store.load(userId);
    const byMetric = new Map();
    for (const r of doc.readings) {
      if (!byMetric.has(r.metric)) byMetric.set(r.metric, []);
      byMetric.get(r.metric).push(r);
    }
    const metrics = [...byMetric.entries()].map(([metric, readings]) => {
      const sorted = [...readings].sort((a, b) => b.date.localeCompare(a.date));
      return { metric, unit: sorted[0].unit, latest: sorted[0], readings: sorted };
    }).sort((a, b) => a.metric.localeCompare(b.metric));
    return { metrics };
  }

  async remove(id, userId) {
    const doc = await this.#store.load(userId);
    doc.readings = doc.readings.filter((r) => r.id !== id);
    await this.#store.save(doc, userId);
    this.#logger.info?.('health.medical.removed', { id });
  }
}
export default MedicalReadingsService;
