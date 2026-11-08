/**
 * One read-modify-write at a time per title (two Admin tabs, or the review and the scenes
 * use cases, must not clobber the same override). Shared by every content-filter use case.
 */
export function createTitleQueue() {
  const queues = new Map(); // key -> tail promise
  return {
    run(key, fn) {
      const prev = queues.get(key) || Promise.resolve();
      const next = prev.catch(() => {}).then(fn);
      queues.set(key, next);
      next.finally(() => { if (queues.get(key) === next) queues.delete(key); }).catch(() => {});
      return next;
    },
  };
}
