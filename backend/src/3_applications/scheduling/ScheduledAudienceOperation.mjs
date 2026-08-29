/** Applies one scheduled use case to the current application-owned audience. */
export class ScheduledAudienceOperation {
  constructor({ listSubjects, executeForSubject, logger = console, failureEvent = null,
    continueOnError = false }) {
    if (typeof listSubjects !== 'function' || typeof executeForSubject !== 'function') {
      throw new TypeError('ScheduledAudienceOperation requires listSubjects and executeForSubject');
    }
    this.listSubjects = listSubjects;
    this.executeForSubject = executeForSubject;
    this.logger = logger;
    this.failureEvent = failureEvent;
    this.continueOnError = continueOnError;
  }

  async execute() {
    for (const subject of this.listSubjects()) {
      try {
        await this.executeForSubject(subject);
      } catch (error) {
        if (!this.continueOnError) throw error;
        this.logger.warn?.(this.failureEvent, { username: subject, error: error.message });
      }
    }
  }
}
