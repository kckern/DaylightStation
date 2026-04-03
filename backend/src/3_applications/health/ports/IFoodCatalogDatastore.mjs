/**
 * IFoodCatalogDatastore - Port for food catalog persistence.
 */
export class IFoodCatalogDatastore {
  async findByNormalizedName(name, userId) { throw new Error('Not implemented'); }
  async search(query, userId, limit) { throw new Error('Not implemented'); }
  async getRecent(userId, limit) { throw new Error('Not implemented'); }
  async save(entry, userId) { throw new Error('Not implemented'); }
  async getById(id, userId) { throw new Error('Not implemented'); }
  async getAll(userId) { throw new Error('Not implemented'); }
}
