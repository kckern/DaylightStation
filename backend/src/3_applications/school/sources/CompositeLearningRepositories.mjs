// backend/src/3_applications/school/sources/CompositeLearningRepositories.mjs
//
// `GetLearningCatalog` and `BuildLearningLesson` each take ONE catalog repository
// and ONE content repository, not a registry. Rather than teach them about
// multiple sources — which would push source-precedence policy into two use cases
// that currently have none — the several sources are merged behind the same two
// port shapes. Every consumer keeps seeing a single repository.
//
// PRECEDENCE IS FIRST-WINS, IN THE ORDER GIVEN. The composition root puts authored
// YAML first, so a hand-authored catalog or document always overrides a generated
// one and an author can correct the projection without touching code.
//
// A source that THROWS is logged and skipped, never allowed to blank the others:
// `GetLearningCatalog` turns any throw into a failed `/catalogs` request for the
// whole household, so one degraded source must not take the authored curriculum
// with it. A source that legitimately has no answer returns null/[] and the next
// source is consulted.

/** Merge several `ILearningCatalogRepository`-shaped sources into one. */
export class CompositeLearningCatalogRepository {
  #sources;
  #logger;

  constructor({ sources, logger = null } = {}) {
    const list = (sources ?? []).filter(Boolean);
    if (list.length === 0) {
      throw new Error('CompositeLearningCatalogRepository requires at least one source');
    }
    if (!list.every((source) => typeof source.listCatalogs === 'function' && typeof source.getCatalog === 'function')) {
      throw new Error('CompositeLearningCatalogRepository sources must implement listCatalogs and getCatalog');
    }
    this.#sources = list;
    this.#logger = logger;
  }

  /**
   * Every source's catalogs, in source order, first-wins on a duplicate catalogId
   * so the listing can never disagree with what `getCatalog` resolves.
   */
  async listCatalogs() {
    const out = [];
    const seen = new Set();
    for (const source of this.#sources) {
      let entries;
      try {
        // eslint-disable-next-line no-await-in-loop
        entries = await source.listCatalogs();
      } catch (error) {
        this.#logger?.error?.('school.catalog.source-failed', { op: 'listCatalogs', error: error.message });
        continue;
      }
      for (const entry of entries ?? []) {
        if (!entry?.catalogId || seen.has(entry.catalogId)) continue;
        seen.add(entry.catalogId);
        out.push(entry);
      }
    }
    return out;
  }

  async getCatalog(catalogId) {
    for (const source of this.#sources) {
      let found;
      try {
        // eslint-disable-next-line no-await-in-loop
        found = await source.getCatalog(catalogId);
      } catch (error) {
        this.#logger?.error?.('school.catalog.source-failed', { op: 'getCatalog', catalogId, error: error.message });
        continue;
      }
      if (found) return found;
    }
    return null;
  }
}

/** Merge several `ILearningContentRepository`-shaped sources into one. */
export class CompositeLearningContentRepository {
  #sources;
  #logger;

  constructor({ sources, logger = null } = {}) {
    const list = (sources ?? []).filter(Boolean);
    if (list.length === 0) {
      throw new Error('CompositeLearningContentRepository requires at least one source');
    }
    this.#sources = list;
    this.#logger = logger;
  }

  async getDocument(documentId) {
    return this.#first('getDocument', documentId);
  }

  async getQuestionBank(bankId) {
    return this.#first('getQuestionBank', bankId);
  }

  async getFlashcardDeck(deckId) {
    return this.#first('getFlashcardDeck', deckId);
  }

  async getLearningAction(actionId) {
    return this.#first('getLearningAction', actionId);
  }

  async #first(method, id) {
    for (const source of this.#sources) {
      if (typeof source[method] !== 'function') continue;
      let found;
      try {
        // eslint-disable-next-line no-await-in-loop
        found = await source[method](id);
      } catch (error) {
        this.#logger?.error?.('school.content.source-failed', { op: method, id, error: error.message });
        continue;
      }
      if (found) return found;
    }
    return null;
  }
}

export default CompositeLearningCatalogRepository;
