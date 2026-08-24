/**
 * IWorkSessionRepository — persistence contract for work-session event logs.
 * @module applications/school/ports/IWorkSessionRepository
 *
 * A work session is stored as an APPEND-ONLY event log (spec §5.1); its state is
 * derived on every read by `reduceSession`. The repository therefore offers no
 * "update" and no "save state" — there is nothing mutable to save. Corrections
 * are events too.
 *
 * @example
 * class YamlWorkSessionDatastore extends IWorkSessionRepository {
 *   async appendEvent(sessionId, event) { ... }
 * }
 */
export class IWorkSessionRepository {
  /**
   * Append one event to a session's log.
   *
   * The implementation OWNS `seq`: it must be assigned inside whatever guard
   * serialises concurrent appends. Two callers that each read `nextSeq()` before
   * either wrote would otherwise be handed the same number, and one child's
   * event would overwrite another's.
   *
   * @param {string} sessionId
   * @param {object} event - a validated event from `createEvent`; `seq` is (re)stamped
   * @param {{expectedSeq?: number}} [options] - optional compare-and-append revision
   * @returns {Promise<object>} the stored event, including its assigned `seq`
   */
  async appendEvent(sessionId, event, options = {}) { // eslint-disable-line no-unused-vars
    throw new Error('IWorkSessionRepository.appendEvent must be implemented');
  }

  /**
   * Read a session's whole log, in `seq` order.
   *
   * An unreadable log resolves to `[]` rather than throwing: one corrupt session
   * must not take down the agenda for every other child.
   *
   * @param {string} sessionId
   * @returns {Promise<object[]>}
   */
  async readEvents(sessionId) {
    throw new Error('IWorkSessionRepository.readEvents must be implemented');
  }

  /**
   * Sessions this learner still has open — the "what am I in the middle of"
   * lookup the agenda needs without walking history.
   *
   * @param {string} learnerId
   * @returns {Promise<Array<{ sessionId: string, learnerId: string, unitId: string|null,
   *                          state: string|null, day: string, updatedAt: string|null }>>}
   */
  async listOpenForLearner(learnerId) {
    throw new Error('IWorkSessionRepository.listOpenForLearner must be implemented');
  }

  /**
   * Every session this learner has, open or finished — the planner's input.
   *
   * Gating asks "has this unit been passed?", which no list of OPEN sessions can
   * answer. Returning derived facts (not events) is what keeps drawing one
   * agenda from reducing a whole term's history.
   *
   * @param {string} learnerId
   * @returns {Promise<Array<{ sessionId: string, learnerId: string, unitId: string|null,
   *                          state: string|null, terminal: boolean,
   *                          outcome: {result: string}|null, gradedPercent: number|null,
   *                          day: string, updatedAt: string|null }>>}
   */
  async listForLearner(learnerId) {
    throw new Error('IWorkSessionRepository.listForLearner must be implemented');
  }

  /**
   * The seq the next appended event will carry. Advisory only — see `appendEvent`.
   *
   * @param {string} sessionId
   * @returns {Promise<number>} 1 for a session with no events
   */
  async nextSeq(sessionId) {
    throw new Error('IWorkSessionRepository.nextSeq must be implemented');
  }
}

export default IWorkSessionRepository;
