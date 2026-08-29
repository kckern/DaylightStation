/** Hourly teacher advocacy workflow for review/print work blocking a learner. */
export class SchoolTeacherBacklogNudge {
  constructor({ reviewQueue, listPendingPrints, reloadSchoolConfig, readCachedSchoolConfig, notifier, clock, logger = console }) {
    this.reviewQueue = reviewQueue;
    this.listPendingPrints = listPendingPrints;
    this.reloadSchoolConfig = reloadSchoolConfig;
    this.readCachedSchoolConfig = readCachedSchoolConfig;
    this.notifier = notifier;
    this.clock = clock;
    this.logger = logger;
  }

  async execute() {
    try {
      const pendingReview = this.reviewQueue ? (await this.reviewQueue.listPending()).length : 0;
      const pendingPrints = this.listPendingPrints?.().length || 0;
      if (!pendingReview && !pendingPrints) return { kind: 'empty' };

      let schoolConfig;
      try {
        schoolConfig = await this.reloadSchoolConfig?.();
      } catch (error) {
        this.logger.warn?.('school.teacher-nudge.reload-failed', { error: error.message });
      }
      schoolConfig ||= this.readCachedSchoolConfig?.() || {};
      const teacherIds = schoolConfig?.teachers ?? [];
      this.logger.info?.('school.teacher-nudge.teachers', { count: teacherIds.length });
      const parts = [];
      if (pendingReview) parts.push(`${pendingReview} item${pendingReview === 1 ? '' : 's'} waiting on a mark`);
      if (pendingPrints) parts.push(`${pendingPrints} print${pendingPrints === 1 ? '' : 's'} awaiting approval`);
      const day = this.clock.today();
      for (const username of teacherIds) {
        await this.notifier.send({
          title: 'School backlog',
          body: `${parts.join(' and ')} — a child may be blocked on you.`,
          category: 'school',
          urgency: 'normal',
          actions: [{ label: 'Open the console', action: 'open', data: { url: '/school/teacher' } }],
          metadata: { username },
          dedupeKey: `school-backlog:${username}:${day}`,
        });
      }
      return { kind: 'sent', recipients: teacherIds.length };
    } catch (error) {
      this.logger.warn?.('school.teacher-nudge.failed', { error: error.message });
      return { kind: 'failed', error };
    }
  }
}

export default SchoolTeacherBacklogNudge;
