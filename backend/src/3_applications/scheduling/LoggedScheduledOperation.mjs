/** Runs one scheduled capability with an explicit, non-throwing failure policy. */
export class LoggedScheduledOperation {
  constructor({ run, logger = console, failureEvent }) {
    if (typeof run !== 'function' || !failureEvent) {
      throw new TypeError('LoggedScheduledOperation requires run and failureEvent');
    }
    this.run = run;
    this.logger = logger;
    this.failureEvent = failureEvent;
  }

  async execute() {
    try {
      return await this.run();
    } catch (error) {
      this.logger.warn?.(this.failureEvent, { error: error.message });
      return null;
    }
  }
}
