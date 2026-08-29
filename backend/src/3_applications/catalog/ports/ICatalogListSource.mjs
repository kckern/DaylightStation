export class ICatalogListSource {
  async getList(_source, _id) { throw new Error('ICatalogListSource.getList must be implemented'); }
}
