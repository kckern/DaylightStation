import path from 'node:path';
import { ILearningCatalogRepository } from '#apps/school/ports/ILearningCatalogRepository.mjs';
import { listYamlFiles, loadYaml } from '#system/utils/FileIO.mjs';

/** Read published Catalog YAML from one or more explicitly configured mounts. */
export class YamlLearningCatalogRepository extends ILearningCatalogRepository {
  #directories; #io;

  constructor({ directories, io = {} } = {}) {
    super();
    if (!Array.isArray(directories) || directories.length === 0 || !directories.every(nonEmptyString)) {
      throw new Error('YamlLearningCatalogRepository requires non-empty directories');
    }
    this.#directories = [...directories];
    this.#io = { list: io.list ?? listYamlFiles, load: io.load ?? loadYaml };
  }

  async listCatalogs() {
    return this.#scan().map(({ document }) => ({
      catalogId: document.catalogId,
      title: document.title,
    }));
  }

  async getCatalog(catalogId) {
    const found = this.#scan().find(({ document }) => document.catalogId === catalogId);
    return found ? structuredClone(found.document) : null;
  }

  #scan() {
    const found = [];
    const byId = new Map();
    for (const directory of this.#directories) {
      const files = [...this.#io.list(directory, { recursive: true })].sort();
      for (const relative of files) {
        const document = this.#io.load(path.join(directory, relative));
        if (!document || typeof document.catalogId !== 'string' || !document.catalogId) {
          throw new Error(`School Catalog file '${relative}' has no catalogId`);
        }
        if (byId.has(document.catalogId)) {
          throw new Error(`Duplicate School catalogId '${document.catalogId}' in '${byId.get(document.catalogId)}' and '${path.join(directory, relative)}'`);
        }
        byId.set(document.catalogId, path.join(directory, relative));
        found.push({ document, file: relative });
      }
    }
    return found;
  }
}

function nonEmptyString(value) { return typeof value === 'string' && value.trim().length > 0; }

export default YamlLearningCatalogRepository;
