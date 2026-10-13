/** Runtime scheduling boundary for application-owned timeout policy. */
export class IAsyncScheduler {
  withDeadline(_work, _deadline) { throw new Error('withDeadline must be implemented'); }
  every(_intervalMs, _task) { throw new Error('every must be implemented'); }
  wait(_delayMs) { throw new Error('wait must be implemented'); }
}

export default IAsyncScheduler;
