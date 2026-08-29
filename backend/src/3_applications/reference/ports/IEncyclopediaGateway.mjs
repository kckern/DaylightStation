export class IEncyclopediaGateway {
  async search(_query, _options) { throw new Error('IEncyclopediaGateway.search must be implemented'); }
  async getArticle(_title) { throw new Error('IEncyclopediaGateway.getArticle must be implemented'); }
  async random() { throw new Error('IEncyclopediaGateway.random must be implemented'); }
  async health() { throw new Error('IEncyclopediaGateway.health must be implemented'); }
}
