export class GamingObservability {
  constructor({ logger = null, auditStore = null, sampleRawInput = () => false, inputBatchSize = 25 } = {}) { this.logger = logger; this.auditStore = auditStore; this.sampleRawInput = sampleRawInput; this.inputBatchSize = inputBatchSize; this.metrics = new Map(); this.inputBatch = new Map(); this.inputCount = 0; }
  increment(name, tags = {}) { const key = `${name}:${JSON.stringify(tags)}`; this.metrics.set(key, (this.metrics.get(key) || 0) + 1); this.logger?.debug?.('gaming.metric', { name, value: this.metrics.get(key), tags }); }
  operational(event, fields = {}, level = 'info') { this.logger?.[level]?.(event, fields); }
  trace(name, fields = {}) {
    const started = performance.now();
    return (outcome = 'ok', extra = {}) => {
      const durationMs = Math.max(0, performance.now() - started);
      this.increment(`${name}.completed`, { outcome });
      this.logger?.debug?.('gaming.trace', { name, outcome, duration_ms: durationMs, ...fields, ...extra });
      return durationMs;
    };
  }
  metricSnapshot() { return Object.fromEntries(this.metrics); }
  presentationFailure(fields) { this.increment('presentation.failure', { renderer: fields.renderer || 'unknown' }); this.logger?.warn?.('gaming.presentation.failure', fields); }
  rawInput(fields) {
    const key = `${fields.source || 'unknown'}:${fields.action || 'unknown'}`; this.inputBatch.set(key, (this.inputBatch.get(key) || 0) + 1); this.inputCount += 1;
    if (this.sampleRawInput(fields)) this.logger?.debug?.('gaming.input.sample', fields);
    if (this.inputCount >= this.inputBatchSize) { this.logger?.debug?.('gaming.input.batch', { count: this.inputCount, inputs: Object.fromEntries(this.inputBatch) }); this.inputBatch.clear(); this.inputCount = 0; }
  }
  async audit(sessionId, decision) { await this.auditStore?.appendAudit(sessionId, { recorded_at: new Date().toISOString(), ...decision }); }
}
