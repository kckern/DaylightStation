export class DeviceContentDispatchService {
  #wake; #idempotency; #configuration; #keyboards; #logger;
  #itemActions = new Map();
  constructor({ wakeAndLoad = null, idempotency, configuration, keyboardBindings = null, logger = console }) {
    this.#wake = wakeAndLoad; this.#idempotency = idempotency; this.#configuration = configuration;
    this.#keyboards = keyboardBindings; this.#logger = logger;
  }
  configured() { return !!this.#wake; }
  logLoadStart(deviceId, query) { this.#logger.info?.('device.router.load.start', { deviceId, query }); }
  checkInput(deviceId) {
    const input = this.#configuration.device(deviceId)?.input;
    if (!input?.required || !input?.keyboard_id) return { ok: true };
    if (!this.#keyboards) return { ok: false,
      error: 'input precondition cannot be verified (loadFile not wired)', keyboardId: input.keyboard_id };
    const normalize = value => value?.replace(/\s+/g, '').toLowerCase();
    const target = normalize(input.keyboard_id);
    const entries = this.#keyboards.list().filter(binding => normalize(binding.folder) === target && binding.key && binding.function);
    if (entries.length === 0) return { ok: false,
      error: `input device '${input.keyboard_id}' has no keymap entries`, keyboardId: input.keyboard_id };
    return { ok: true, keymapSize: entries.length };
  }
  async load(deviceId, query) {
    const { dispatchId, ...contentQuery } = query;
    const action = typeof contentQuery.itemAction === 'string' ? JSON.parse(contentQuery.itemAction) : contentQuery.itemAction;
    const key = action?.operationId ? JSON.stringify([deviceId, action.operationId]) : null;
    if (key && !this.#itemActions.has(key)) this.#itemActions.set(key, { status: 'pending', tappedAt: action.tappedAt });
    const result = await this.#wake.execute(deviceId, contentQuery, {
      dispatchId,
      ...(key ? { isCancelled: () => this.#itemActions.get(key)?.cancelled === true } : {}),
    });
    this.#logger.info?.('device.router.load.complete', { deviceId, ok: result.ok,
      failedStep: result.failedStep, totalElapsedMs: result.totalElapsedMs });
    return result;
  }
  claimItemAction(deviceId, operationId) {
    const record = this.#itemActions.get(JSON.stringify([deviceId, operationId]));
    if (record?.cancelled) return { ok: false, code: 'ITEM_ACTION_CANCELLED' };
    if (record) record.status = 'claimed';
    return { ok: true };
  }
  cancelItemAction(deviceId, operationId) {
    const record = this.#itemActions.get(JSON.stringify([deviceId, operationId]));
    if (!record) {
      this.#itemActions.set(JSON.stringify([deviceId, operationId]), { status: 'unknown', cancelled: true });
      return { ok: true, pending: false };
    }
    if (record.cancelled) return { ok: true, pending: record.status === 'pending' };
    if (Date.now() >= record.tappedAt + 10000) return { ok: false, code: 'UNDO_EXPIRED' };
    const pending = record.status === 'pending';
    record.cancelled = true;
    return { ok: true, pending };
  }
  async adopt(deviceId, snapshot, dispatchId) {
    this.#logger.info?.('device.router.load.adopt.start', { deviceId, dispatchId });
    return this.#idempotency.runWithIdempotency(dispatchId, { snapshot, deviceId }, async () => {
      const result = await this.#wake.execute(deviceId, {}, { dispatchId, adoptSnapshot: snapshot });
      this.#logger.info?.('device.router.load.adopt.complete', { deviceId, dispatchId,
        ok: result.ok, failedStep: result.failedStep });
      return {
        kind: result.error === 'Device not found'
          ? 'device_not_found'
          : (result.ok ? 'adopted' : 'dispatch_failed'),
        result,
        dispatchId,
      };
    });
  }
  logInputFailure(deviceId, result) {
    this.#logger.error?.('device.router.load.input-precondition-failed', {
      deviceId, keyboardId: result.keyboardId, error: result.error,
    });
  }
  logConflict(deviceId, dispatchId) {
    this.#logger.warn?.('device.router.load.adopt.conflict', { deviceId, dispatchId });
  }
}
