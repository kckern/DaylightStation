let sequence = 0;

/** Runtime capabilities for isolated application tests. */
export function testApplicationRuntime() {
  return {
    clock: { now: () => Date.now() },
    createDispatchId: () => `test-dispatch-${++sequence}`,
    scheduler: {
      after: (delayMs, task) => {
        const timer = setTimeout(task, delayMs);
        return () => clearTimeout(timer);
      },
      cancel: (handle) => {
        if (typeof handle === 'function') handle();
        else clearTimeout(handle);
      },
      wait: (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
      withDeadline: (work, { milliseconds, errorFactory } = {}) => {
        let timer;
        const deadline = new Promise((_, reject) => {
          timer = setTimeout(() => reject(errorFactory?.() || new Error('timeout')), milliseconds);
        });
        return Promise.race([Promise.resolve(work), deadline]).finally(() => clearTimeout(timer));
      },
    },
  };
}
