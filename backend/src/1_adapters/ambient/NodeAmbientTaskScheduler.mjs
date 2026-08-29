import { IAmbientTaskScheduler } from '#apps/ambient/ports/IAmbientTaskScheduler.mjs';

/** Node runtime cadence for the ambient workflow. */
export class NodeAmbientTaskScheduler extends IAmbientTaskScheduler {
  every(intervalMs, task) {
    const timer = setInterval(task, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }
}

export default NodeAmbientTaskScheduler;
