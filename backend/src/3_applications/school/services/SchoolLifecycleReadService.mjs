/** Read projections over lifecycle sessions, review, curriculum, and assignments. */
export class SchoolLifecycleReadService {
  constructor({ sessions = null, listLearnerSessions = null, listPrintableWorksheetSessions = null,
    reviewQueue = null, curriculum = null, assignments = null } = {}) {
    Object.assign(this, { sessions, listLearnerSessions, listPrintableWorksheetSessions, reviewQueue, curriculum, assignments });
  }

  hasSessions() { return Boolean(this.sessions); }
  hasPrintableSessions() { return Boolean(this.sessions && this.listPrintableWorksheetSessions); }
  hasReview() { return Boolean(this.reviewQueue); }
  hasCurriculum() { return Boolean(this.curriculum); }
  hasAssignments() { return Boolean(this.assignments); }
  async learnerSessions(learnerId, window = null) {
    return this.listLearnerSessions
      ? this.listLearnerSessions.execute({ learnerId, window })
      : this.sessions.listForLearner(learnerId);
  }
  sessionEvents(sessionId) { return this.sessions.readEvents(sessionId); }
  printableSessions(learnerId, window = 'today') {
    return this.listPrintableWorksheetSessions.execute({ learnerId, window });
  }
  pendingReview() { return this.reviewQueue.listPending(); }
  sessionReview(sessionId) { return this.reviewQueue.listForSession(sessionId); }
  units() { return this.curriculum.listUnitSummaries(); }
  unit(unitId) { return this.curriculum.getUnitSummary(unitId); }
  assignmentList() { return this.assignments.list(); }
  assignment(learnerId) { return this.assignments.get(learnerId); }
}

export default SchoolLifecycleReadService;
