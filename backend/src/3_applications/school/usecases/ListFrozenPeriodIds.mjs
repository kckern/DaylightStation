/** Collects period ids with frozen report cards without letting one bad shard lock edits. */
export class ListFrozenPeriodIds {
  constructor({ listLearners, listReportCards, logger = console } = {}) {
    if (typeof listLearners !== 'function' || typeof listReportCards !== 'function') {
      throw new Error('ListFrozenPeriodIds requires listLearners and listReportCards');
    }
    this.listLearners = listLearners;
    this.listReportCards = listReportCards;
    this.logger = logger;
  }

  execute() {
    const periodIds = [];
    for (const learner of this.listLearners() || []) {
      try {
        for (const report of this.listReportCards(learner.id) || []) {
          if (report?.periodId) periodIds.push(report.periodId);
        }
      } catch (error) {
        this.logger.warn?.('school.frozen-periods.shard-unreadable', { learnerId: learner.id, error: error.message });
      }
    }
    return periodIds;
  }
}

export default ListFrozenPeriodIds;
