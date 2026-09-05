/**
 * YAML persistence for resolved book records.
 *
 *   <householdPath>/books/{isbn13}.yml
 *
 * One file per book, household-wide — book facts are not private, and a
 * sibling's lookup should warm the cache for everyone.
 *
 * READS FAIL OPEN: missing and corrupt both answer null, so a bad file is a
 * refetch, never a dead lookup. A corrupt read is logged at warn so it is
 * visible. WRITES FAIL LOUD: an isbn that is not thirteen digits throws,
 * because it is about to become a filename.
 *
 * Records are re-normalised through `createBookRecord` on the way out, so a
 * hand-edited or older file still yields the complete, frozen model.
 *
 * @module adapters/persistence/yaml/YamlBookRepository
 */
import path from 'path';
import yaml from 'js-yaml';
import { fileExists, readFile, writeFileAtomic, ensureDir } from '#system/utils/FileIO.mjs';
import { IBookRepository } from '#apps/books/ports/IBookRepository.mjs';
import { createBookRecord } from '#domains/books/BookRecord.mjs';

const ISBN13 = /^\d{13}$/;

export class YamlBookRepository extends IBookRepository {
  #configService;
  #logger;
  #clock;

  /**
   * @param {object} deps
   * @param {object} deps.configService - must expose `getHouseholdPath(suffix)`
   * @param {object} [deps.logger]
   */
  constructor({ configService, logger = console, clock = () => new Date() } = {}) {
    super();
    if (!configService || typeof configService.getHouseholdPath !== 'function') {
      throw new Error('YamlBookRepository: configService with getHouseholdPath() is required');
    }
    this.#configService = configService;
    this.#logger = logger;
    this.#clock = typeof clock === 'function' ? clock : () => new Date();
  }

  #fileFor(isbn13) {
    return path.join(this.#configService.getHouseholdPath('books'), `${isbn13}.yml`);
  }

  async findByIsbn(isbn13) {
    return (await this.findByIsbnEntry(isbn13))?.book ?? null;
  }

  async findByIsbnEntry(isbn13) {
    if (!ISBN13.test(String(isbn13 ?? ''))) return null;
    const file = this.#fileFor(isbn13);
    if (!fileExists(file)) return null;
    try {
      const loaded = yaml.load(readFile(file));
      if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)) throw new Error('not a mapping');
      return {
        book: createBookRecord(loaded),
        cachedAt: typeof loaded.cachedAt === 'string' ? loaded.cachedAt : null,
      };
    } catch (error) {
      this.#logger.warn?.('books.repository.corrupt', { isbn13, file, error: error.message });
      return null;
    }
  }

  async save(record) {
    const isbn13 = record?.isbn13;
    if (!ISBN13.test(String(isbn13 ?? ''))) {
      throw new Error(`YamlBookRepository: a record needs a thirteen-digit isbn13 to be saved, got: ${isbn13}`);
    }
    const file = this.#fileFor(isbn13);
    ensureDir(path.dirname(file));
    // Frozen records dump fine; spread to a plain object anyway so js-yaml sees
    // no exotic prototypes. Arrays are frozen too — copy them.
    const plain = Object.fromEntries(
      Object.entries(record).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]),
    );
    plain.cachedAt = this.#clock().toISOString();
    writeFileAtomic(file, yaml.dump(plain, { lineWidth: 120 }));
    this.#logger.debug?.('books.repository.saved', { isbn13, sources: record.sources });
    return record;
  }
}

export default YamlBookRepository;
