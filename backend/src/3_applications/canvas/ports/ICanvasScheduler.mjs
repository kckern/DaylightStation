/**
 * Port for scheduling canvas rotation.
 * Application layer consumes this; adapters implement it.
 */
export function validateScheduler(impl) {
  const required = ['scheduleRotation', 'resetTimer', 'cancelRotation'];
  for (const method of required) {
    if (typeof impl[method] !== 'function') {
      throw new Error(`ICanvasScheduler requires ${method} to be a function`);
    }
  }
}
