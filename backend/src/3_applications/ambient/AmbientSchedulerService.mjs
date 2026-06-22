// backend/src/3_applications/ambient/AmbientSchedulerService.mjs
// Application service: the 60s ambient tick. Gathers inputs (schedule, local
// time, per-device idle), calls the pure evaluator, executes the returned
// actions via injected ports, and persists next state.
import { resolveNowParts } from '#domains/ambient/timeParts.mjs';
import { evaluateAmbientSchedule } from '#domains/ambient/evaluateAmbientSchedule.mjs';

const DEFAULT_INTERVAL_MS = 60000;

export class AmbientSchedulerService {
  #loadSchedule; #tracker; #wakeAndLoad; #deviceService; #stateStore;
  #timeZone; #logger; #clock; #timer; #firstTick; #running;

  constructor({
    loadSchedule, tracker, wakeAndLoadService, deviceService, stateStore,
    timeZone = 'America/Los_Angeles', logger = console, clock = Date,
  }) {
    this.#loadSchedule = loadSchedule;
    this.#tracker = tracker;
    this.#wakeAndLoad = wakeAndLoadService;
    this.#deviceService = deviceService;
    this.#stateStore = stateStore;
    this.#timeZone = timeZone;
    this.#logger = logger;
    this.#clock = clock;
    this.#timer = null;
    this.#firstTick = true;
    this.#running = false;
  }

  start(intervalMs = DEFAULT_INTERVAL_MS) {
    const tick = () => this.runOnce().catch(
      (e) => this.#logger.error?.('ambient.tick.error', { error: String(e?.message ?? e) }));
    tick();
    this.#timer = setInterval(tick, intervalMs);
    this.#timer.unref?.();
    this.#logger.info?.('ambient.started', { intervalMs });
  }

  stop() { if (this.#timer) clearInterval(this.#timer); this.#timer = null; }

  async runOnce(date = new Date(this.#clock.now())) {
    if (this.#running) {
      this.#logger.info?.('ambient.tick.skipped-reentrant', {});
      return { actions: [], state: null, skipped: true };
    }
    this.#running = true;
    try {
      const { windows, warnings } = await this.#loadSchedule();
      warnings.forEach((w) => this.#logger.warn?.('ambient.window.invalid', w));

      const now = resolveNowParts(date, this.#timeZone);
      const state = await this.#stateStore.load();

      const devices = [...new Set(windows.map((w) => w.device))];
      const idleByDevice = {};
      for (const d of devices) idleByDevice[d] = !this.#tracker.isPlaying(d);

      const firstTick = this.#firstTick;
      this.#firstTick = false;

      const { actions, state: nextState } = evaluateAmbientSchedule({
        windows, now, state, idleByDevice, firstTick,
      });

      for (const a of actions) {
        try {
          if (a.type === 'load') {
            this.#logger.info?.('ambient.load', { device: a.device, preset: a.preset });
            await this.#wakeAndLoad.execute(a.device, { display: a.display });
          } else if (a.type === 'powerOff') {
            this.#logger.info?.('ambient.powerOff', { device: a.device });
            const dev = this.#deviceService.get(a.device);
            if (dev) await dev.powerOff();
          } else {
            this.#logger.info?.(`ambient.${a.type}`, a);
          }
        } catch (err) {
          this.#logger.error?.('ambient.action.failed', { type: a.type, device: a.device, error: String(err?.message ?? err) });
          // A failed load must not leave a phantom ownership (else we'd power off a
          // TV we never actually turned on).
          if (a.type === 'load' && nextState.owned && nextState.owned.key === a.key) {
            nextState.owned = null;
          }
        }
      }

      await this.#stateStore.save(nextState);
      return { actions, state: nextState };
    } finally {
      this.#running = false;
    }
  }
}

export default AmbientSchedulerService;
