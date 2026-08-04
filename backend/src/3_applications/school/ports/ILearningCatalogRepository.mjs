/** Raw published School catalogs. Validation remains in the School domain. */
export class ILearningCatalogRepository {
  /** @returns {Promise<Array<{catalogId: string, title: string}>>} */
  async listCatalogs() {
    throw new Error('ILearningCatalogRepository.listCatalogs must be implemented');
  }

  /** @returns {Promise<object|null>} raw parsed catalog or null */
  async getCatalog(catalogId) { // eslint-disable-line no-unused-vars
    throw new Error('ILearningCatalogRepository.getCatalog must be implemented');
  }
}

export default ILearningCatalogRepository;
