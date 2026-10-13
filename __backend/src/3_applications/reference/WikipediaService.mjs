export class WikipediaService {
  #encyclopedia;
  constructor({ encyclopedia }) { this.#encyclopedia = encyclopedia; }
  search(query, options) { return this.#encyclopedia.search(query, options); }
  article(title) { return this.#encyclopedia.getArticle(title); }
  random() { return this.#encyclopedia.random(); }
  health() { return this.#encyclopedia.health(); }
}
