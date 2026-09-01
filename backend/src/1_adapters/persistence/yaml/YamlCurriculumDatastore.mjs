/**
 * YAML persistence for the published curriculum catalog (spec §3). Dumb storage
 * only — it parses files and hands the result straight back; every rule about
 * what a valid unit/document/manifest looks like lives in the domain.
 *
 *   units      <dataDir>/content/school/{subject}/{work}/units/{unitId}.yml
 *   documents  <dataDir>/content/school/{subject}/{work}/documents/{id}.yml
 *   manifests  <dataDir>/content/school/{subject}/{work}/manifests/{id}.yml
 *   poster     <mediaDir>/school/{subject}/{work}/poster.jpg
 *
 * The poster sits in the MEDIA tree beside the work's source PDF, on the same
 * shelf/work path. The content tree holds what an author writes and reviews;
 * a megabyte of cover scan is not that, and keeping the two apart means a
 * course's authored YAML stays diffable.
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
import yaml from 'js-yaml';
import {
  fileExists, listYamlFiles, loadYamlSafe, readBinaryFromPathAsync, readDirectory,
  readTextFromPathAsync,
} from '#system/utils/FileIO.mjs';
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

  #workDir(subject, work) {
    return path.join(this.#schoolDir(), subject, work);
  }

  /**
   * Where a work's BYTES live — cover scan, source PDF — as opposed to the
   * authored YAML above. Same shelf/work shape, different tree, because the
   * content tree is the thing an author edits and reviews and a 1MB cover scan
   * is neither.
   */
  #workMediaDir(subject, work) {
    return path.join(this.#configService.getMediaDir(), 'school', subject, work);
  }

  #courseConfig(subject, work) {
    const root = this.#workDir(subject, work);
    return loadYamlSafe(path.join(root, '_index')) ?? loadYamlSafe(path.join(root, 'index')) ?? loadYamlSafe(path.join(root, 'course'));
  }

  /**
   * Work directories on one shelf. A work (Shakespeare Tales, math-fractions) is
   * a self-contained folder holding its own units, documents, manifests and
   * quizzes; a shelf with no works yet simply has no directories to list.
   */
  #works(subject) {
    try {
      return readDirectory(path.join(this.#schoolDir(), subject), { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name);
    } catch { return []; /* empty shelf */ }
  }

  #courseV2(subject, work) {
    return this.#courseConfig(subject, work)?.schema === COURSE_V2;
  }

  /**
   * V2 lesson metadata projects into the existing unit port for compatibility.
   *
   * A compact lesson is one `<lessonId>.yml` question-bank file carrying its
   * lesson metadata under `lesson:`. Rich lessons retain a directory with an
   * `_index.yml` plus separately named artifacts. The catalog deliberately
   * discovers the semantic records rather than treating `units/` and
   * `lessons/` as required wrapper directories, so the filesystem remains an
   * authoring convenience rather than a second curriculum model.
   */
  #v2Lessons(subject, work, errors) {
    if (!this.#courseV2(subject, work)) return [];
    const root = this.#workDir(subject, work);
    const course = this.#courseConfig(subject, work);
    // Each compact lesson owns its pedagogy, while the course index owns the
    // print-book citation. Preserve that relationship in the unit projection
    // so worksheet cards name the book a learner actually holds, not an EPUB
    // authoring sidecar embedded in lesson provenance.
    const sourceTitle = course?.source?.title ?? course?.title ?? null;
    const delivery = course?.medium === 'paper' && course?.grading?.gate === 'omr' ? 'paper' : null;
    const out = [];
    for (const file of listYamlFiles(root, { recursive: true, stripExtension: false })) {
      const absolute = path.join(root, file);
      const raw = loadYamlSafe(absolute);
      const stem = file.replace(YAML_FILE_RE, '');
      const fileStem = path.basename(stem);
      const lessonIndex = ['index', '_index'].includes(fileStem);
      const declaredUnitId = raw?.lesson?.unitId;
      // A v2 lesson may live in a human-readable nested path (for example,
      // `olympians/aphrodite.yml`) while its published curriculum identity is
      // `greek-myths-14-aphrodite`.  The declared unitId is the identifier
      // that assignments, history, and bank backlinks use; treating the leaf
      // filename as canonical made those valid references unrecoverable.
      const id = typeof declaredUnitId === 'string' && CURRICULUM_ID_RE.test(declaredUnitId)
        ? declaredUnitId
        : fileStem;
      if (!CURRICULUM_ID_RE.test(id) && !lessonIndex) {
        if (raw?.lesson) {
          errors.push(`${subject}/${work}/${file}: unsafe lesson id`);
        }
        continue;
      }
      if (raw?.lesson && typeof raw.lesson === 'object' && !Array.isArray(raw.lesson)) {
        if (!CURRICULUM_ID_RE.test(id)) {
          errors.push(`${subject}/${work}/${file}: lesson.unitId must match ${CURRICULUM_ID_RE.source}`);
          continue;
        }
        out.push({ id, file, subject, dir: root, embeddedLesson: true, sourceTitle, delivery });
      } else if (lessonIndex && raw?.schema === 'school.unit/v1' && raw?.bank) {
        const lessonId = CURRICULUM_ID_RE.test(raw.unitId) ? raw.unitId : path.basename(path.dirname(stem));
        if (!CURRICULUM_ID_RE.test(lessonId)) {
          errors.push(`${subject}/${work}/${file}: unsafe lesson id`);
        } else {
          out.push({ id: lessonId, file, subject, dir: root, embeddedLesson: false, sourceTitle, delivery });
        }
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
          entries = readDirectory(dir, { withFileTypes: true });
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
      const chunk = await Promise.all(slice.map(async ({ id, file, subject, dir, embeddedLesson = false, sourceTitle = null, delivery = null }) => {
        try {
          const document = yaml.load(await readTextFromPathAsync(path.join(dir, file)));
          // An empty (or `null`) file is not an entity. Reporting it beats
          // handing the validators a null to reject with a vaguer message.
          if (document === null || document === undefined) return { id, error: 'file is empty' };
          const lesson = embeddedLesson ? document.lesson : document;
          if (lesson === null || lesson === undefined) return { id, error: 'lesson metadata is empty' };
          const raw = {
            ...lesson,
            ...(sourceTitle && !lesson.sourceTitle ? { sourceTitle } : {}),
            ...(delivery && !lesson.delivery ? { delivery } : {}),
          };
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
    if (kind === KINDS.units) {
      const errors = [];
      for (const subject of SUBJECT_IDS) {
        for (const work of this.#works(subject)) {
          const match = this.#v2Lessons(subject, work, errors).find((entry) => entry.id === id);
          if (!match) continue;
          const document = loadYamlSafe(path.join(match.dir, match.file));
          const lesson = match.embeddedLesson ? document?.lesson ?? null : document;
          if (!lesson) return lesson;
          return {
            ...lesson,
            ...(match.sourceTitle && !lesson.sourceTitle ? { sourceTitle: match.sourceTitle } : {}),
            ...(match.delivery && !lesson.delivery ? { delivery: match.delivery } : {}),
          };
        }
      }
    }
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
        const root = this.#workDir(subject, work);
        const file = v2 && fileExists(path.join(root, '_index.yml'))
          ? path.join(root, '_index.yml')
          : v2 && fileExists(path.join(root, 'index.yml'))
            ? path.join(root, 'index.yml')
            : v2 ? path.join(root, 'course.yml') : path.join(root, 'work.yml');
        let text;
        try {
          text = await readTextFromPathAsync(file); // eslint-disable-line no-await-in-loop
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
    return this.#courseV2(subject, work)
      ? this.#courseConfig(subject, work)
      : loadYamlSafe(path.join(this.#workDir(subject, work), 'work')) ?? null;
  }

  async getCoursePoster(id) {
    if (typeof id !== 'string' || !CURRICULUM_ID_RE.test(id)) return null;
    for (const subject of SUBJECT_IDS) {
      const course = this.#courseConfig(subject, id);
      if (course?.schema !== COURSE_V2 || course?.poster !== 'poster.jpg') continue;
      try {
        const bytes = await readBinaryFromPathAsync(path.join(this.#workMediaDir(subject, id), 'poster.jpg'));
        // JPEG SOI + marker. Serving a renamed SVG/HTML file as an image from a
        // teacher-authenticated route would still be content-sniffing trouble.
        if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
        return bytes;
      } catch { return null; }
    }
    return null;
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
