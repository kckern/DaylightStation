import { IApplicationScheduler } from '#apps/common/ports/IApplicationScheduler.mjs';

/** Node runtime implementation of application timing capabilities. */
export class NodeApplicationScheduler extends IApplicationScheduler {
  after(delayMs, task) {
    const timer = setTimeout(task, delayMs);
    return () => clearTimeout(timer);
  }

  every(intervalMs, task) {
    const timer = setInterval(task, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  wait(delayMs) {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  withDeadline(work, { milliseconds, errorFactory } = {}) {
    let cancel = null;
    const deadline = new Promise((_, reject) => {
      cancel = this.after(milliseconds, () => reject(
        errorFactory?.() ?? new Error(`Operation timed out after ${milliseconds}ms`),
      ));
    });
    return Promise.race([Promise.resolve(work), deadline]).finally(() => cancel?.());
  }
}

export default NodeApplicationScheduler;
