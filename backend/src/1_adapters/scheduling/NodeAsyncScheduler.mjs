import { IAsyncScheduler } from '#apps/school/ports/IAsyncScheduler.mjs';

/** Node runtime implementation of School's scheduling capability. */
export class NodeAsyncScheduler extends IAsyncScheduler {
  withDeadline(work, { milliseconds, description = 'operation' } = {}) {
    let timer = null;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${description} timed out after ${milliseconds}ms`)), milliseconds);
    });
    return Promise.race([Promise.resolve(work), deadline]).finally(() => clearTimeout(timer));
  }

  every(intervalMs, task) {
    const timer = setInterval(task, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  wait(delayMs) {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

export default NodeAsyncScheduler;
