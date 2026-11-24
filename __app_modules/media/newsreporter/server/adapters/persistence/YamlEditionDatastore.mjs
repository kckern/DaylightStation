/**
 * YamlEditionDatastore (1_adapters) — the IEditionStore for edition reporters.
 *
 *   record: data/household/newsreporter/editions/<reporterId>/<date>.yml
 *   image:  <mediaDir>/newsreporter/<reporterId>/<date>.png
 *
 * The record goes through DataService (the household YAML tree, Dropbox
 * synced); the image goes to the media volume, because binaries never live in
 * the data tree. Ids and dates are checked before they become path segments.
 */
import path from 'node:path';
import { IEditionStore } from '../../application/ports/IEditionStore.mjs';
import { listYamlFiles, writeBinaryAtomic, readBinary, fileExists } from '#system/utils/FileIO.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const RECORD_BASE = 'newsreporter/editions';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[a-z0-9][a-z0-9_-]*$/i;

function checkKey(reporterId, date) {
  if (!ID_RE.test(String(reporterId))) throw new InfrastructureError(`bad reporter id: ${reporterId}`, { code: 'BAD_EDITION_KEY' });
  if (date !== undefined && !DATE_RE.test(String(date))) throw new InfrastructureError(`bad edition date: ${date}`, { code: 'BAD_EDITION_KEY' });
}

export class YamlEditionDatastore extends IEditionStore {
  #dataService;
  #mediaDir;
  #logger;

  /**
   * @param {{ dataService: object, mediaDir: string|null, logger?: object }} deps
   */
  constructor({ dataService, mediaDir, logger = console } = {}) {
    super();
    if (!dataService?.household) {
      throw new InfrastructureError('YamlEditionDatastore requires dataService', { code: 'MISSING_DEPENDENCY', dependency: 'dataService' });
    }
    this.#dataService = dataService;
    this.#mediaDir = mediaDir || null;
    this.#logger = logger;
  }

  #recordPath(reporterId, date) {
    return `${RECORD_BASE}/${reporterId}/${date}`;
  }

  #imagePath(reporterId, date) {
    if (!this.#mediaDir) throw new InfrastructureError('YamlEditionDatastore has no mediaDir for images', { code: 'MISSING_DEPENDENCY', dependency: 'mediaDir' });
    return path.join(this.#mediaDir, 'newsreporter', reporterId, `${date}.png`);
  }

  async get(reporterId, date) {
    checkKey(reporterId, date);
    const record = this.#dataService.household.read(this.#recordPath(reporterId, date));
    return record && typeof record === 'object' ? { ...record, date } : null;
  }

  async save(reporterId, date, record) {
    checkKey(reporterId, date);
    const { date: _drop, ...rest } = record || {};
    this.#dataService.household.write(this.#recordPath(reporterId, date), { date, ...rest });
    this.#logger.debug?.('newsreporter.edition.store.saved', { reporterId, date, status: rest.status ?? null });
  }

  async list(reporterId, { limit = 30, before = null } = {}) {
    checkKey(reporterId);
    const dir = this.#dataService.household.resolveDir(`${RECORD_BASE}/${reporterId}`);
    const dates = listYamlFiles(dir)
      .filter((name) => DATE_RE.test(name))
      .filter((name) => !before || name < before)
      .sort()
      .reverse()
      .slice(0, Math.max(0, limit));
    const records = [];
    for (const date of dates) {
      // eslint-disable-next-line no-await-in-loop
      const record = await this.get(reporterId, date);
      if (record) records.push(record);
    }
    return records;
  }

  async savePng(reporterId, date, buffer) {
    checkKey(reporterId, date);
    writeBinaryAtomic(this.#imagePath(reporterId, date), buffer);
  }

  async readPng(reporterId, date) {
    checkKey(reporterId, date);
    if (!this.#mediaDir) return null;
    return readBinary(this.#imagePath(reporterId, date));
  }

  async pngPath(reporterId, date) {
    checkKey(reporterId, date);
    if (!this.#mediaDir) return null;
    const file = this.#imagePath(reporterId, date);
    return fileExists(file) ? file : null;
  }
}

export default YamlEditionDatastore;
