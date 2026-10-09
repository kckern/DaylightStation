/**
 * Port for receiving canvas-related events from infrastructure.
 * Application layer consumes this; adapters implement it.
 */
export function validateEventSource(impl) {
  const required = ['onMotionDetected', 'onContextTrigger', 'onManualAdvance'];
  for (const method of required) {
    if (typeof impl[method] !== 'function') {
      throw new Error(`ICanvasEventSource requires ${method} to be a function`);
    }
  }
}
