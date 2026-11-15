/** Append-only evidence for one learner and study day; program reducers own meaning. */
export class IProgramDayStore {
  async read(learnerId, studyDay) { throw new Error('IProgramDayStore.read must be implemented'); }
  async append(learnerId, studyDay, event) { throw new Error('IProgramDayStore.append must be implemented'); }
  async listDays(learnerId, range) { throw new Error('IProgramDayStore.listDays must be implemented'); }
}
export default IProgramDayStore;
