export class ISavedMealsDatastore {
  async list(userId) { throw new Error('ISavedMealsDatastore.list must be implemented'); }
  async getById(id, userId) { throw new Error('ISavedMealsDatastore.getById must be implemented'); }
  async save(meal, userId) { throw new Error('ISavedMealsDatastore.save must be implemented'); }
  async remove(id, userId) { throw new Error('ISavedMealsDatastore.remove must be implemented'); }
}
export default ISavedMealsDatastore;
