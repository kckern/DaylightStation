// Race a promise against a timeout so a wedged network call can never hang the
// UI. On timeout the result is the TIMEOUT sentinel (NOT a rejection) so callers
// can decide to proceed — used to bound recording-finalize, which is safe to skip
// because the audio is durable in IndexedDB + server chunks and draft recovery
// will finalize it on the next mount.
export const TIMEOUT = Symbol('weekly-review-timeout');

export function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
