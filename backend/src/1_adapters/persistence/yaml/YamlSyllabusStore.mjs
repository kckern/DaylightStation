/**
 * YAML persistence for syllabi (docs/reference/school/enrollment.md §4).
 *
 *   <dataDir>/household/apps/school/syllabi/{syllabusId}.yml
 *
 * Same posture as the sibling `YamlAssignmentStore`: parent-editable by hand,
 * atomic replace, one serialized write chain, and a refusal to clobber a file
 * that is currently unparseable — a parent mid-edit must not lose their work
 * to a console save.
 *
 * Archival is a soft delete (`archivedAt`), never an unlink: an enrollment
 * keeps a `syllabusId` as provenance, and the drawer must still be able to
 * name where an enrollment came from after the syllabus stops being offered.
 */
import path from 'path';
import { promises as fs } from 'fs';
import yaml from 'js-yaml';
import { DomainInvariantError } from '#domains/core/errors/index.mjs';

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const YAML_FILE_RE = /\.(yml|yaml)$/;

const dumpYaml = (value) => yaml.dump(value, { indent: 2, lineWidth: -1, noRefs: true });
const isSafeId = (id) => typeof id === 'string' && SLUG.test(id);
const stagingPathFor = (filePath) => `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export class YamlSyllabusStore {
  #configService;
  #logger;
  #writeChain = Promise.resolve();
  #corrupt = new Set();

  constructor(config = {}) {
    if (!config.configService || typeof config.configService.getHouseholdPath !== 'function') {
      throw new Error('YamlSyllabusStore: configService with getHouseholdPath() is required');
    }
    this.#configService = config.configService;
    this.#logger = config.logger || console;
  }

  #root() { return this.#configService.getHouseholdPath('apps/school/syllabi'); }

  #fileFor(syllabusId) { return path.join(this.#root(), `${syllabusId}.yml`); }

  async #read(syllabusId) {
    let text;
    try {
      text = await fs.readFile(this.#fileFor(syllabusId), 'utf8');
    } catch (err) {
      if (err?.code === 'ENOENT') { this.#corrupt.delete(syllabusId); return null; }
      this.#markCorrupt(syllabusId);
      return null;
    }
    let raw;
    try {
      raw = yaml.load(text);
    } catch {
      this.#markCorrupt(syllabusId);
      return null;
    }
    this.#corrupt.delete(syllabusId);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    return raw;
  }

  #markCorrupt(syllabusId) {
    this.#corrupt.add(syllabusId);
    this.#logger.warn?.('school.syllabus.file-corrupt', { syllabusId, file: this.#fileFor(syllabusId) });
  }

  async #writeYamlAtomic(filePath, content) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const staging = stagingPathFor(filePath);
    try {
      await fs.writeFile(staging, dumpYaml(content), 'utf8');
      await fs.rename(staging, filePath);
    } catch (err) {
      await fs.unlink(staging).catch(() => {});
      throw err;
    }
  }

  async get(syllabusId) {
    if (!isSafeId(syllabusId)) return null;
    return this.#read(syllabusId);
  }

  async list() {
    let names;
    try {
      names = await fs.readdir(this.#root());
    } catch {
      return [];
    }
    const ids = names
      .filter((n) => YAML_FILE_RE.test(n))
      .map((n) => n.replace(YAML_FILE_RE, ''))
      .filter(isSafeId)
      .sort();
    const records = await Promise.all(ids.map((id) => this.#read(id)));
    return records.filter((r) => r && !r.archivedAt);
  }

  async put(record) {
    const { syllabusId } = record ?? {};
    if (!isSafeId(syllabusId)) throw new Error(`YamlSyllabusStore: unsafe syllabusId: ${syllabusId}`);
    const stored = { ...record, updatedAt: record.updatedAt ?? new Date().toISOString() };
    const queued = this.#writeChain.then(async () => {
      await this.#read(syllabusId); // for its side effect on #corrupt
      if (this.#corrupt.has(syllabusId)) {
        throw new DomainInvariantError(
          `syllabus file '${syllabusId}' is corrupt — refusing to overwrite it`,
          { code: 'SYLLABUS_CORRUPT', details: { syllabusId, file: this.#fileFor(syllabusId) } },
        );
      }
      await this.#writeYamlAtomic(this.#fileFor(syllabusId), stored);
      this.#corrupt.delete(syllabusId);
      return stored;
    });
    this.#writeChain = queued.catch(() => {});
    return queued;
  }

  async archive(syllabusId, { archivedBy = null, at = new Date().toISOString() } = {}) {
    const current = await this.get(syllabusId);
    if (!current) return null;
    return this.put({ ...current, archivedAt: at, archivedBy, updatedAt: at });
  }
}

export default YamlSyllabusStore;
