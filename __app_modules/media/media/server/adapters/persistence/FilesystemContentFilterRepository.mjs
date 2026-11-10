import {
  buildContainedPath,
  fileExists,
  fileMtimeMs,
  listFiles,
  listYamlFiles,
  readFile,
  readYamlFromPath,
  saveYamlToPathAtomic,
  writeFileAtomic,
} from '#system/utils/FileIO.mjs';
import { IContentFilterRepository } from "../../application/content-filter/ports/IContentFilterRepository.mjs";

/**
 * YAML/filesystem implementation of the content-filter repository.
 *
 * Curated profiles and overrides live below the household root. Regenerable
 * EDL files live below the media root. Raw filesystem mechanics remain in
 * FileIO; this adapter owns only the storage layout and YAML record shape.
 */
export class FilesystemContentFilterRepository extends IContentFilterRepository {
  #householdDir;
  #mediaDir;
  #logger;

  constructor({ householdDir, mediaDir, logger = console } = {}) {
    super();
    if (!householdDir) {
      throw new Error('FilesystemContentFilterRepository requires householdDir');
    }
    if (!mediaDir) {
      throw new Error('FilesystemContentFilterRepository requires mediaDir');
    }
    this.#householdDir = householdDir;
    this.#mediaDir = mediaDir;
    this.#logger = logger;
  }

  async getEdl(ratingKey) {
    return this.#readYaml(this.#mediaDir, `content-filter/edl/${ratingKey}.edl.yml`);
  }

  async getRefinedEdl({ workId, tagSetId } = {}) {
    const id = /^\d+$/;
    if (!id.test(String(workId ?? '')) || !id.test(String(tagSetId ?? ''))) return null;
    return this.#readYaml(this.#mediaDir, `content-filter/refined/${workId}-${tagSetId}.edl.yml`);
  }

  async saveRefinedEdl({ workId, tagSetId } = {}, edl) {
    const id = /^\d+$/;
    if (!id.test(String(workId ?? '')) || !id.test(String(tagSetId ?? ''))) throw new Error('saveRefinedEdl needs numeric workId and tagSetId');
    this.#writeYaml(this.#mediaDir, `content-filter/refined/${workId}-${tagSetId}.edl.yml`, edl);
  }

  async getTranscript(ratingKey, part) {
    if (!/^\d+$/.test(String(part ?? ''))) return null;
    const filePath = buildContainedPath(this.#mediaDir, `content-filter/refine/${ratingKey}/words-${part}.json`);
    if (!filePath || !fileExists(filePath)) return null;
    try {
      const { segments = [] } = JSON.parse(readFile(filePath));
      return { segments };
    } catch (error) {
      this.#logger.warn?.('content-filter.read.error', { path: filePath, error: error.message });
      return null;
    }
  }

  async getProfile(profileName) {
    return this.#readYaml(this.#householdDir, `content-filter/profiles/${profileName}.yml`);
  }

  async saveProfile(profileName, profile) {
    const name = String(profileName ?? '');
    if (!/^[a-z0-9_-]+$/.test(name)) throw new Error('saveProfile needs a profile name of [a-z0-9_-]');
    this.#writeYaml(this.#householdDir, `content-filter/profiles/${name}.yml`, profile);
  }

  async saveEdl(ratingKey, edl) {
    if (!/^\d+$/.test(String(ratingKey ?? ''))) throw new Error('saveEdl needs a numeric ratingKey');
    this.#writeYaml(this.#mediaDir, `content-filter/edl/${ratingKey}.edl.yml`, edl);
  }

  async getRefineReview(ratingKey) {
    if (!/^\d+$/.test(String(ratingKey ?? ''))) return null;
    return this.#readYaml(this.#householdDir, `content-filter/review/${ratingKey}.refine.yml`);
  }

  async saveRefineReview(ratingKey, review) {
    if (!/^\d+$/.test(String(ratingKey ?? ''))) throw new Error('saveRefineReview needs a numeric ratingKey');
    this.#writeYaml(this.#householdDir, `content-filter/review/${ratingKey}.refine.yml`, review);
  }

  async listTranscriptFiles(ratingKey) {
    if (!/^\d+$/.test(String(ratingKey ?? ''))) return {};
    const dir = buildContainedPath(this.#mediaDir, `content-filter/refine/${ratingKey}`);
    const out = {};
    for (const name of dir ? listFiles(dir) : []) {
      const m = /^words-(\d+)\.json$/.exec(name);
      if (!m) continue;
      try { out[m[1]] = JSON.parse(readFile(`${dir}/${name}`)); } catch { /* skip a broken file */ }
    }
    return out;
  }

  async saveTranscriptFile(ratingKey, part, words) {
    if (!/^\d+$/.test(String(ratingKey ?? '')) || !/^\d+$/.test(String(part ?? ''))) throw new Error('saveTranscriptFile needs numeric ratingKey and part');
    const filePath = buildContainedPath(this.#mediaDir, `content-filter/refine/${ratingKey}/words-${part}.json`);
    writeFileAtomic(filePath, JSON.stringify(words));
  }

  async getMatchIndex() {
    return this.#readYaml(this.#mediaDir, 'content-filter/plex-vidangel-map.yml');
  }

  /** When the match index file was last written (ISO), or null. */
  async getMatchIndexWrittenAt() {
    const filePath = buildContainedPath(this.#mediaDir, 'content-filter/plex-vidangel-map.yml');
    try {
      const ms = filePath && fileExists(filePath) ? fileMtimeMs(filePath) : null;
      return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
    } catch { return null; }
  }

  async getOverride(ratingKey) {
    return this.#readYaml(this.#householdDir, `content-filter/overrides/${ratingKey}.yml`);
  }

  async listOverrides() {
    const dir = buildContainedPath(this.#householdDir, 'content-filter/overrides');
    return dir ? listYamlFiles(dir).filter((n) => /^\d+$/.test(n)) : [];
  }

  async saveOverride(ratingKey, override) {
    this.#writeYaml(this.#householdDir, `content-filter/overrides/${ratingKey}.yml`, override);
  }

  #writeYaml(root, relativePath, content) {
    const filePath = buildContainedPath(root, relativePath);
    if (!filePath) throw new Error(`content-filter path escapes its root: ${relativePath}`);
    // Atomic: the player reads these files on every title load; a half-written
    // override (no sync) or refined EDL would filter a whole viewing wrongly.
    saveYamlToPathAtomic(filePath, content, { lineWidth: 140 });
  }

  #readYaml(root, relativePath) {
    const filePath = buildContainedPath(root, relativePath);
    if (!filePath || !fileExists(filePath)) return null;
    try {
      return readYamlFromPath(filePath) || null;
    } catch (error) {
      this.#logger.warn?.('content-filter.read.error', {
        path: filePath,
        error: error.message,
      });
      return null;
    }
  }
}

export default FilesystemContentFilterRepository;
