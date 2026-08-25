/**
 * ListPrintableWorksheetSessions — the small, truthful selection list for a
 * teacher's combined worksheet.  It deliberately does not expose every
 * session opened today: video/program lessons cannot become paper merely
 * because their ids happen to be on the same agenda.
 */
import { statesAccepting } from '#domains/school/sessions/sessionEvents.mjs';

// Derived from the transition table, not hand-copied — see `IssueDocument`'s
// own ISSUABLE for why the answer is the union of these two events' states.
const ISSUABLE = new Set([...statesAccepting('issued'), ...statesAccepting('reprinted')]);

export class ListPrintableWorksheetSessions {
  #listSessions; #curriculum;

  constructor({ listLearnerSessions, curriculum } = {}) {
    if (!listLearnerSessions || !curriculum) {
      throw new Error('ListPrintableWorksheetSessions requires listLearnerSessions and curriculum');
    }
    this.#listSessions = listLearnerSessions;
    this.#curriculum = curriculum;
  }

  async execute({ learnerId, window = 'today' } = {}) {
    const sessions = await this.#listSessions.execute({ learnerId, window });
    const printable = [];
    for (const session of sessions) {
      if (!session?.sessionId || !ISSUABLE.has(session.state)) continue;
      // eslint-disable-next-line no-await-in-loop
      const unit = await this.#curriculum.getUnit(session.unitId);
      if (!unit?.bank || unit.document) continue;
      printable.push({
        sessionId: session.sessionId,
        unitId: unit.unitId,
        title: unit.title,
        subject: unit.subject ?? 'school',
        courseId: unit.courseId ?? null,
        state: session.state,
      });
    }
    return printable;
  }
}

export default ListPrintableWorksheetSessions;
