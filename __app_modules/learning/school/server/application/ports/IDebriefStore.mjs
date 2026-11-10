/**
 * One learner's debrief events for one study day. Append-only; state is derived
 * on read (`deriveDebriefState`). read() never throws for missing/corrupt.
 */
export class IDebriefStore {
  async read(learnerId, studyDay) { throw new Error('IDebriefStore.read must be implemented'); }
  async append(learnerId, studyDay, event) { throw new Error('IDebriefStore.append must be implemented'); }
  async listDays(learnerId, range) { throw new Error('IDebriefStore.listDays must be implemented'); }
}
export default IDebriefStore;
