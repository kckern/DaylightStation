// backend/src/3_applications/canvas/services/CanvasService.mjs
import { validateEventSource } from '../ports/ICanvasEventSource.mjs';
import { validateScheduler } from '../ports/ICanvasScheduler.mjs';
import { validateContextProvider } from '../ports/IContextProvider.mjs';

/**
 * Application service for canvas art display.
 * Orchestrates adapters and domain logic via ports.
 * No infrastructure knowledge - only interfaces.
 */
export class CanvasService {
  #contentSources;
  #selectionService;
  #scheduler;
  #contextProvider;
  #historyStore;

  constructor({ contentSources, selectionService, scheduler, eventSource, contextProvider, historyStore }) {
    validateEventSource(eventSource);
    validateScheduler(scheduler);
    validateContextProvider(contextProvider);

    this.#contentSources = contentSources;
    this.#selectionService = selectionService;
    this.#scheduler = scheduler;
    this.#contextProvider = contextProvider;
    this.#historyStore = historyStore;

    // Wire up events via ports
    eventSource.onMotionDetected((deviceId) => {
      this.#scheduler.resetTimer(deviceId);
    });

    eventSource.onManualAdvance((deviceId) => {
      // Will be called to advance to next item
    });

    eventSource.onContextTrigger((deviceId, triggerType) => {
      // Will be called on time boundary or calendar change
    });
  }

  async getCurrent(deviceId, householdId) {
    const context = await this.#contextProvider.getContext(deviceId, householdId);
    const allItems = await Promise.all(
      this.#contentSources.map(source => source.list(context.filters))
    );
    const pool = allItems.flat();
    const filtered = this.#selectionService.selectForContext(pool, context);
    const history = await this.#historyStore.getShownHistory(deviceId);
    const selected = this.#selectionService.pickNext(filtered, history, context.options);
    if (selected) {
      await this.#historyStore.recordShown(deviceId, selected.id);
    }
    return selected;
  }

  async startRotation(deviceId, householdId) {
    const context = await this.#contextProvider.getContext(deviceId, householdId);
    const intervalMs = (context.options.interval || 300) * 1000;
    this.#scheduler.scheduleRotation(deviceId, intervalMs, async () => {
      await this.getCurrent(deviceId, householdId);
    });
  }

  stopRotation(deviceId) {
    this.#scheduler.cancelRotation(deviceId);
  }
}

export default CanvasService;
