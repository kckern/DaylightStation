/**
 * YAML persistence for the published curriculum catalog (spec §3). Dumb storage
 * only — it parses files and hands the result straight back; every rule about
 * what a valid unit/document/manifest looks like lives in the domain.
 *
 *   units      <dataDir>/content/school/{subject}/{work}/units/{unitId}.yml
 *   documents  <dataDir>/content/school/{subject}/{work}/documents/{id}.yml
 *   manifests  <dataDir>/content/school/{subject}/{work}/manifests/{id}.yml
 *
 * Filed under the nine subject shelves so the tree reads the way the School home
 * does. The shelf is a DIRECTORY here, but it is not the address: ids stay flat
 * and globally unique because everything else refers to them bare
 * (`assignments/{learner}.yml` says `courses: [math-fractions]`). So the same id
 * may not appear under two subjects, and this adapter reports it if it does.
 *
 * A unit also carries `subject:` in-file, which the domain validates. That makes
 * two places to say the same thing, so this adapter cross-checks them and
 * reports a mismatch. The FIELD stays the source of truth — the domain owns it,
 * and Plex-sourced material has no folder at all — but only storage can see the
 * folder, so only storage can catch the drift.
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
import { SUBJECT_IDS } from '#domains/school/curriculum/unitValidation.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * Curriculum ids are FLAT basenames — the subject folder above them is filing,
 * not addressing, so no '/' is allowed and traversal has nowhere to go. Dots are
 * allowed because a unit names its course chapter that way (`math-3.4`), and
 * requiring a leading alphanumeric is what keeps `..` and `.hidden` out.
 */
const CURRICULUM_ID_RE = /^[a-z0-9][a-z0-9._-]*$/i;

const KINDS = Object.freeze({ units: 'units', documents: 'documents', manifests: 'manifests' });
const YAML_FILE_RE = /\.(yml|yaml)$/;
const COURSE_V2 = 'school.course/v2';

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

  #schoolDir() {
    return path.join(this.#configService.getDataDir(), 'content', 'school');
  }

  #kindDir(subject, work, kind) {
    return path.join(this.#schoolDir(), subject, work, kind);
  }

  #curriculumWorks(subject) {
    const root = path.join(this.#schoolDir(), 'curriculum', subject);
    try {
      return fs.readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => entry.name);
    } catch { return []; }
  }

  #workDir(subject, work) {
    const curriculumDir = path.join(this.#schoolDir(), 'curriculum', subject, work);
    if (loadYamlSafe(path.join(curriculumDir, 'index'))?.schema === COURSE_V2) return curriculumDir;
    return path.join(this.#schoolDir(), subject, work);
  }

  /**
   * Work directories on one shelf. A work (Shakespeare Tales, math-fractions) is
   * a self-contained folder holding its own units, documents, manifests and
   * quizzes; a shelf with no works yet simply has no directories to list.
   */
  #works(subject) {
    let legacy = [];
    try {
      legacy = fs.readdirSync(path.join(this.#schoolDir(), subject), { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name);
    } catch { /* empty shelf */ }
    return [...new Set([...this.#curriculumWorks(subject), ...legacy])];
  }

  #courseV2(subject, work) {
    return loadYamlSafe(path.join(this.#workDir(subject, work), 'index'))?.schema === COURSE_V2;
  }

  /** V2 lesson indexes project into the existing unit port for compatibility. */
  #v2Lessons(subject, work, errors) {
    if (!this.#courseV2(subject, work)) return [];
    const unitsDir = path.join(this.#workDir(subject, work), 'units');
    const out = [];
    let units = [];
    try { units = fs.readdirSync(unitsDir, { withFileTypes: true }); } catch (err) {
      if (err.code !== 'ENOENT') errors.push(`${subject}/${work}/units: unreadable directory (${err.message})`);
    }
    for (const unit of units.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))) {
      const lessonsDir = path.join(unitsDir, unit.name, 'lessons');
      let lessons = [];
      try { lessons = fs.readdirSync(lessonsDir, { withFileTypes: true }); } catch (err) {
        if (err.code !== 'ENOENT') errors.push(`${subject}/${work}/units/${unit.name}/lessons: unreadable directory (${err.message})`);
      }
      for (const lesson of lessons.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))) {
        if (!CURRICULUM_ID_RE.test(lesson.name)) {
          errors.push(`${subject}/${work}/units/${unit.name}/lessons/${lesson.name}: unsafe lesson id`); continue;
        }
        out.push({ id: lesson.name, file: 'index.yml', subject, dir: path.join(lessonsDir, lesson.name) });
      }
    }
    return out;
  }

  /**
   * Directory entries for one kind across every subject, as
   * `{ id, file, subject, dir }`. Subdirectories below the kind are ignored (ids
   * are flat) and unsafe names are surfaced rather than dropped — a file nobody
   * can address is an authoring mistake worth seeing.
   */
  #scan(kind, errors) {
    const out = [];
    const seen = new Map();
    for (const subject of SUBJECT_IDS) {
      for (const work of this.#works(subject)) {
        if (kind === KINDS.units) {
          for (const entry of this.#v2Lessons(subject, work, errors)) {
            const prior = seen.get(entry.id);
            if (prior) errors.push(`${kind}/${entry.id}: duplicate id in ${prior} and ${subject}/${work}, latter skipped`);
            else { seen.set(entry.id, `${subject}/${work}`); out.push(entry); }
          }
        }
        const dir = this.#courseV2(subject, work)
          ? path.join(this.#workDir(subject, work), kind)
          : this.#kindDir(subject, work, kind);
        const where = `${subject}/${work}/${kind}`;
        let entries;
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (err) {
          // A directory that does not exist yet is an empty shelf, not a throw —
          // most works have no curriculum of a given kind. Anything else (a
          // file where a directory should be, bad permissions) is reported;
          // blanking the catalog because of it is how a whole shelf silently
          // disappears.
          if (err.code !== 'ENOENT') errors.push(`${where}: unreadable directory (${err.message})`);
          continue;
        }
        for (const entry of entries) {
          if (!entry.isFile() || entry.name.startsWith('.') || !YAML_FILE_RE.test(entry.name)) continue;
          const id = entry.name.replace(YAML_FILE_RE, '');
          if (!CURRICULUM_ID_RE.test(id)) {
            errors.push(`${where}/${id}: unsafe id, skipped (must match ${CURRICULUM_ID_RE.source})`);
            continue;
          }
          // Ids address globally, so the same one under two works is ambiguous:
          // a bare reference could not say which was meant.
          const prior = seen.get(id);
          if (prior) {
            errors.push(`${kind}/${id}: duplicate id in ${prior} and ${subject}/${work}, latter skipped`);
            continue;
          }
          seen.set(id, `${subject}/${work}`);
          out.push({ id, file: entry.name, subject, dir });
        }
      }
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
    const items = [];
    for (let i = 0; i < entries.length; i += batch) {
      const slice = entries.slice(i, i + batch);
      // eslint-disable-next-line no-await-in-loop
      const chunk = await Promise.all(slice.map(async ({ id, file, subject, dir }) => {
        try {
          const raw = yaml.load(await fs.promises.readFile(path.join(dir, file), 'utf8'));
          // An empty (or `null`) file is not an entity. Reporting it beats
          // handing the validators a null to reject with a vaguer message.
          if (raw === null || raw === undefined) return { id, error: 'file is empty' };
          return { id, raw, subject };
        } catch (err) {
          return { id, error: err.message };
        }
      }));
      for (const result of chunk) {
        if (result.error) { errors.push(`${kind}/${result.id}: ${result.error}`); continue; }
        // Only units carry `subject:`; documents and manifests take their shelf
        // from the folder alone, so there is nothing to disagree with.
        const declared = result.raw?.subject;
        if (declared !== undefined && declared !== result.subject) {
          errors.push(`${kind}/${result.id}: filed under ${result.subject}/ but declares subject: ${declared}`);
        }
        items.push({ id: result.id, raw: result.raw });
      }
    }
    return { items, errors };
  }

  async #get(kind, id) {
    if (typeof id !== 'string' || !CURRICULUM_ID_RE.test(id)) return null;
    // Ids are unique across works, so the first hit is the only hit.
    for (const subject of SUBJECT_IDS) {
      for (const work of this.#works(subject)) {
        const found = loadYamlSafe(path.join(this.#kindDir(subject, work, kind), id));
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * Every `work.yml` on the shelves. A work id is its POSITION —
   * `<subject>/<work>` — so unlike the three kinds there is no filename to
   * derive an id from and no possibility of two works colliding.
   */
  async listWorks() {
    const errors = [];
    const items = [];
    for (const subject of SUBJECT_IDS) {
      for (const work of this.#works(subject)) {
        const v2 = this.#courseV2(subject, work);
        const file = path.join(this.#workDir(subject, work), v2 ? 'index.yml' : 'work.yml');
        let text;
        try {
          text = await fs.promises.readFile(file, 'utf8'); // eslint-disable-line no-await-in-loop
        } catch (err) {
          // A work with no config is not an error — most of the imported Khan
          // shelves have none yet, and reporting each would drown the real ones.
          if (err.code !== 'ENOENT') errors.push(`${subject}/${work}: unreadable work.yml (${err.message})`);
          continue;
        }
        try {
          const raw = yaml.load(text);
          if (raw === null || raw === undefined) errors.push(`${subject}/${work}: work.yml is empty`);
          else items.push({ id: `${subject}/${work}`, subject, work, raw });
        } catch (err) {
          errors.push(`${subject}/${work}: ${err.message}`);
        }
      }
    }
    return { items, errors };
  }

  async getWork(id) {
    if (typeof id !== 'string') return null;
    const [subject, work, ...rest] = id.split('/');
    if (rest.length || !SUBJECT_IDS.includes(subject) || !work || !CURRICULUM_ID_RE.test(work)) return null;
    return loadYamlSafe(path.join(this.#workDir(subject, work), this.#courseV2(subject, work) ? 'index' : 'work')) ?? null;
  }

  /** @param {{ batch?: number }} [options] */
  listUnits(options) { return this.#list(KINDS.units, options); }

  /** @param {{ batch?: number }} [options] */
  listDocuments(options) { return this.#list(KINDS.documents, options); }

  /** @param {{ batch?: number }} [options] */
  listManifests(options) { return this.#list(KINDS.manifests, options); }

  async getUnit(unitId) {
    const legacy = await this.#get(KINDS.units, unitId);
    if (legacy) return legacy;
    const listed = await this.#list(KINDS.units);
    return listed.items.find((entry) => entry.id === unitId)?.raw ?? null;
  }

  getDocument(id) { return this.#get(KINDS.documents, id); }

  getManifest(id) { return this.#get(KINDS.manifests, id); }
}

export default YamlCurriculumDatastore;
