/** Runtime cadence capability required by the ambient scheduling workflow. */
export class IAmbientTaskScheduler {
  every(_intervalMs, _task) { throw new Error('every must be implemented'); }
}

export default IAmbientTaskScheduler;
