/**
 * YAML persistence for the published curriculum catalog (spec §3). Dumb storage
 * only — it parses files and hands the result straight back; every rule about
 * what a valid unit/document/manifest looks like lives in the domain.
 *
 *   units      <dataDir>/content/school/curriculum/units/{unitId}.yml
 *   documents  <dataDir>/content/school/curriculum/documents/{id}.yml
 *   manifests  <dataDir>/content/school/curriculum/manifests/{id}.yml
 *
 * Mirrors YamlSchoolDatastore's posture: injected configService, an id regex
 * that makes traversal unrepresentable, and a batched async directory scan so a
 * large catalog does not block the event loop.
 *
 * The one thing this adapter is opinionated about: **a bad file isolates to
 * itself**. Listing returns `{ items, errors }`, so an unparseable unit is
 * reported by name while its siblings still load. Throwing instead would let
 * one fat-fingered file blank the whole catalog — and the catalog is what a
 * child standing at the printer depends on.
 */
import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';
import { loadYamlSafe } from '#system/utils/FileIO.mjs';
import { ICurriculumCatalog } from '#apps/school/ports/ICurriculumCatalog.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * Curriculum ids are FLAT basenames — unlike bank ids there is no folder
 * hierarchy here, so no '/' is allowed and traversal has nowhere to go. Dots are
 * allowed because a unit names its course chapter that way (`math-3.4`), and
 * requiring a leading alphanumeric is what keeps `..` and `.hidden` out.
 */
const CURRICULUM_ID_RE = /^[a-z0-9][a-z0-9._-]*$/i;

const KINDS = Object.freeze({ units: 'units', documents: 'documents', manifests: 'manifests' });
const YAML_FILE_RE = /\.(yml|yaml)$/;

export class YamlCurriculumDatastore extends ICurriculumCatalog {
  #configService;

  constructor(config = {}) {
    super();
    if (!config.configService) {
      throw new InfrastructureError('YamlCurriculumDatastore requires configService', {
        code: 'MISSING_DEPENDENCY', dependency: 'configService',
      });
    }
    this.#configService = config.configService;
  }

  #kindDir(kind) {
    return path.join(this.#configService.getDataDir(), 'content', 'school', 'curriculum', kind);
  }

  /**
   * Directory entries for one kind, as `{ id, file }`. Subdirectories are
   * ignored (ids are flat) and unsafe names are surfaced rather than dropped —
   * a file nobody can address is an authoring mistake worth seeing.
   */
  #scan(kind, errors) {
    const dir = this.#kindDir(kind);
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      // A directory that does not exist yet is an empty catalog, not a throw.
      // Anything else (a file where a directory should be, bad permissions) is
      // reported — blanking the catalog because of it is how a whole shelf of
      // curriculum silently disappears.
      if (err.code !== 'ENOENT') errors.push(`${kind}: unreadable directory (${err.message})`);
      return [];
    }
    const out = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith('.') || !YAML_FILE_RE.test(entry.name)) continue;
      const id = entry.name.replace(YAML_FILE_RE, '');
      if (!CURRICULUM_ID_RE.test(id)) {
        errors.push(`${kind}/${id}: unsafe id, skipped (must match ${CURRICULUM_ID_RE.source})`);
        continue;
      }
      out.push({ id, file: entry.name });
    }
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /**
   * Read every file of one kind ASYNCHRONOUSLY in bounded-concurrency batches,
   * so the scan runs on the libuv threadpool instead of blocking the event loop.
   */
  async #list(kind, { batch = 200 } = {}) {
    const errors = [];
    const entries = this.#scan(kind, errors);
    const dir = this.#kindDir(kind);
    const items = [];
    for (let i = 0; i < entries.length; i += batch) {
      const slice = entries.slice(i, i + batch);
      // eslint-disable-next-line no-await-in-loop
      const chunk = await Promise.all(slice.map(async ({ id, file }) => {
        try {
          const raw = yaml.load(await fs.promises.readFile(path.join(dir, file), 'utf8'));
          // An empty (or `null`) file is not an entity. Reporting it beats
          // handing the validators a null to reject with a vaguer message.
          if (raw === null || raw === undefined) return { id, error: 'file is empty' };
          return { id, raw };
        } catch (err) {
          return { id, error: err.message };
        }
      }));
      for (const result of chunk) {
        if (result.error) errors.push(`${kind}/${result.id}: ${result.error}`);
        else items.push({ id: result.id, raw: result.raw });
      }
    }
    return { items, errors };
  }

  async #get(kind, id) {
    if (typeof id !== 'string' || !CURRICULUM_ID_RE.test(id)) return null;
    return loadYamlSafe(path.join(this.#kindDir(kind), id)) ?? null;
  }

  /** @param {{ batch?: number }} [options] */
  listUnits(options) { return this.#list(KINDS.units, options); }

  /** @param {{ batch?: number }} [options] */
  listDocuments(options) { return this.#list(KINDS.documents, options); }

  /** @param {{ batch?: number }} [options] */
  listManifests(options) { return this.#list(KINDS.manifests, options); }

  getUnit(unitId) { return this.#get(KINDS.units, unitId); }

  getDocument(id) { return this.#get(KINDS.documents, id); }

  getManifest(id) { return this.#get(KINDS.manifests, id); }
}

export default YamlCurriculumDatastore;
