/** Port for the per-user health goals document. */
export class IHealthGoalsDatastore {
  async load(userId) { throw new Error('IHealthGoalsDatastore.load must be implemented'); }
  async save(goals, userId) { throw new Error('IHealthGoalsDatastore.save must be implemented'); }
}
export default IHealthGoalsDatastore;
