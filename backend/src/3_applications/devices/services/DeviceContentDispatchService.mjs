export class DeviceContentDispatchService {
  #wake; #idempotency; #configuration; #keyboards; #logger;
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
    const result = await this.#wake.execute(deviceId, contentQuery, { dispatchId });
    this.#logger.info?.('device.router.load.complete', { deviceId, ok: result.ok,
      failedStep: result.failedStep, totalElapsedMs: result.totalElapsedMs });
    return result;
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
