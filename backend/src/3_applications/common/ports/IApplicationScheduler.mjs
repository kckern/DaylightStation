/** Runtime timing capability shared by application workflows. */
export class IApplicationScheduler {
  after(_delayMs, _task) { throw new Error('after must be implemented'); }
  every(_intervalMs, _task) { throw new Error('every must be implemented'); }
  wait(_delayMs) { throw new Error('wait must be implemented'); }
  withDeadline(_work, _options) { throw new Error('withDeadline must be implemented'); }
}

export default IApplicationScheduler;
