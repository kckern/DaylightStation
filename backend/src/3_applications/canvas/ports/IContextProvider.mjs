/**
 * Port for getting current context (time, calendar, device config).
 * Application layer consumes this; adapters implement it.
 */
export function validateContextProvider(impl) {
  const required = ['getContext', 'getTimeSlot'];
  for (const method of required) {
    if (typeof impl[method] !== 'function') {
      throw new Error(`IContextProvider requires ${method} to be a function`);
    }
  }
}
