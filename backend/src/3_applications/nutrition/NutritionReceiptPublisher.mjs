import { sha256Text } from '#system/utils/sha256.mjs';
import { nutritionReceipt } from '#domains/nutrition/services/nutritionReceipt.mjs';

const hash = value => sha256Text(JSON.stringify(value));

/** Sole final receipt writer. One queue per owner serializes the shared durable
 * checkpoint and every receipt edit. Jobs carry identities, NEVER stale rows.
 * No send capability: captures bind their known processing message; headless
 * capture and uncertain sends cannot accidentally create Telegram duplicates. */
export class NutritionReceiptPublisher {
  #deps; #queues = new Map(); #revisions = new Map();
  constructor(deps) {
    for (const key of ['destinationFor', 'linkFor', 'foodLogs', 'items', 'checkpoints', 'surface', 'renderer', 'logger']) {
      if (!deps[key]) throw new Error(`NutritionReceiptPublisher requires ${key}`);
    }
    this.#deps = deps;
  }
  #exclusive(userId, work) {
    const prior = this.#queues.get(userId) || Promise.resolve();
    const next = prior.catch(() => {}).then(work);
    this.#queues.set(userId, next);
    return next.finally(() => { if (this.#queues.get(userId) === next) this.#queues.delete(userId); });
  }
  publish(userId, options = {}) { return this.#exclusive(userId, () => this.#publish(userId, options)); }
  async refresh(userId, logId, { ready = false } = {}) {
    try { return await this.publish(userId, { logIds: [logId], ready }); }
    catch (error) { this.#deps.logger.warn('nutrition.receipt.retry', { userId, logId, error: error.message }); return { retry: true }; }
  }
  async bind(userId, logId, binding) {
    try { return await this.publish(userId, { logIds: [logId], binding }); }
    catch (error) { this.#deps.logger.warn('nutrition.receipt.bind_retry', { userId, logId, error: error.message }); return { retry: true }; }
  }
  async interaction(userId, logId, mode) {
    try { return await this.publish(userId, { logIds: [logId], interaction: mode }); }
    catch (error) { this.#deps.logger.warn('nutrition.receipt.interaction_retry', { userId, logId, error: error.message }); return { retry: true }; }
  }
  reconcile(userId, { logIds, dryRun = true, expectedFingerprints = {} } = {}) {
    if (!Array.isArray(logIds) || !logIds.length || logIds.length > 20 || new Set(logIds).size !== logIds.length
      || logIds.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) || typeof dryRun !== 'boolean') {
      throw Object.assign(new Error('Select 1–20 distinct receipt log IDs'), { status: 400 });
    }
    if (!expectedFingerprints || typeof expectedFingerprints !== 'object' || Array.isArray(expectedFingerprints)) {
      throw Object.assign(new Error('Expected receipt fingerprints must be an object'), { status: 400 });
    }
    if (!dryRun && logIds.some(id => !/^[a-f0-9]{64}$/.test(expectedFingerprints[id] || ''))) {
      throw Object.assign(new Error('Preview each selected receipt before applying'), { status: 409 });
    }
    return this.publish(userId, { logIds, dryRun, force: true, expectedFingerprints });
  }
  async #publish(userId, options) {
    const d = this.#deps;
    const destination = await d.destinationFor(userId);
    if (!destination) return { receipts: [] };
    const polling = Object.keys(options).length === 0;
    const revision = d.foodLogs.getRevision && d.items.getRevision
      ? hash([destination, await d.foodLogs.getRevision(userId), await d.items.getRevision(userId)]) : null;
    if (polling && revision && this.#revisions.get(userId) === revision) return { receipts: [] };
    // Foreground requests can leave delivery pending even without a ledger edit.
    this.#revisions.delete(userId);
    // Always reload INSIDE the queue: a queued capture cannot overwrite a newer
    // manual correction or committed auditor repair with its old parser result.
    const logs = await d.foodLogs.findAll(userId, { includeArchives: true });
    const rows = await d.items.findByDateRange(userId, '0001-01-01', '9999-12-31');
    const previous = await d.checkpoints.load(userId);
    const migrating = previous?.schema !== 2 || previous.destination !== destination;
    const state = migrating ? { schema: 2, destination, receipts: {}, unavailable: previous?.destination === destination ? previous.unavailable || {} : {} }
      : structuredClone(previous);
    let persisted = hash(previous), retry = false;
    const save = async () => {
      if (options.dryRun || hash(state) === persisted) return;
      await d.checkpoints.save(userId, state);
      persisted = hash(state);
    };
    // Reconciliation preflights EVERY selected receipt before touching Telegram.
    // A stale second target must not result in a partially-applied repair batch.
    if (options.force && options.logIds) {
      for (const id of options.logIds) {
        const log = logs.find(candidate => candidate.id === id);
        const saved = state.receipts[id];
        const binding = saved?.binding || (log && d.linkFor(log, destination))
          || (previous?.destination === destination ? previous.links?.[id] : null);
        if (!log || !binding) throw Object.assign(new Error(`No linked receipt for ${id}`), { status: 404 });
        const rendered = d.renderer.render(nutritionReceipt(log, rows, saved?.interaction), { limit: binding.caption ? 1000 : 4000 });
        if (options.expectedFingerprints?.[id] && options.expectedFingerprints[id] !== hash(rendered)) {
          throw Object.assign(new Error('Receipt changed since preview; preview again'), { status: 409 });
        }
      }
    }
    const receipts = [];
    for (const log of logs) {
      let saved = state.receipts[log.id];
      const inherited = d.linkFor(log, destination) || (previous?.destination === destination ? previous.links?.[log.id] : null);
      if (!saved && inherited) {
        saved = state.receipts[log.id] = { binding: inherited, hash: null };
        // Migration establishes a baseline, not a historical reformat sweep.
        if (migrating) saved.hash = hash(d.renderer.render(nutritionReceipt(log, rows), { limit: inherited.caption ? 1000 : 4000 }));
      }
      const selected = !options.logIds || options.logIds.includes(log.id);
      if (selected && options.binding) {
        const binding = options.binding;
        if (binding.conversationId !== destination || !/^\d+$/.test(String(binding.messageId))) continue;
        const next = { messageId: String(binding.messageId), caption: binding.caption === true };
        if (!saved || hash(saved.binding) !== hash(next)) saved = state.receipts[log.id] = { binding: next, hash: null };
        if (migrating) saved.hash = null;
      }
      if (!saved || !selected) continue;
      if (Object.hasOwn(options, 'interaction')) saved.interaction = options.interaction;
      const rendered = d.renderer.render(nutritionReceipt(log, rows, saved.interaction), { limit: saved.binding.caption ? 1000 : 4000 });
      const next = hash(rendered);
      if (options.expectedFingerprints?.[log.id] && options.expectedFingerprints[log.id] !== next) {
        throw Object.assign(new Error('Receipt changed since preview; preview again'), { status: 409 });
      }
      const changed = saved.hash !== next || options.force === true;
      const result = { logId: log.id, messageId: saved.binding.messageId, changed, fingerprint: next, ...rendered,
        delivery: state.unavailable[saved.binding.messageId] ? 'unavailable' : options.dryRun ? 'preview' : changed ? 'pending' : 'unchanged' };
      receipts.push(result);
      if (options.dryRun || !changed || state.unavailable[saved.binding.messageId]) continue;
      // Persist binding intent before delivery; a crash leaves the edit pending.
      await save();
      if (log.metadata?.reviewOperation?.complete === false || (log.status === 'pending' && !saved.hash && !options.ready)) { retry = true; continue; }
      try {
        await d.surface.updateMessage(destination, saved.binding, rendered);
        saved.hash = next;
        await save();
        result.delivery = 'updated';
        d.logger.info('nutrition.receipt.updated', { userId, logId: log.id, messageId: saved.binding.messageId, fingerprint: next });
      } catch (error) {
        if (error.permanent) state.unavailable[saved.binding.messageId] = { reason: error.message };
        else retry = true;
        result.delivery = error.permanent ? 'unavailable' : 'retry';
        await save();
        d.logger.warn('nutrition.receipt.retry', { userId, logId: log.id, messageId: saved.binding.messageId, error: error.message });
      }
    }
    await save();
    if (polling && revision && !retry) this.#revisions.set(userId, revision);
    return { receipts };
  }
}
