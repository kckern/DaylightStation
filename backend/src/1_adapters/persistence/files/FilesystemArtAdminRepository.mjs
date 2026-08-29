import path from 'node:path';
import yaml from 'js-yaml';
import {
  getFileStatsAsync,
  readDirectoryAsync,
  readTextFromPathAsync,
  writeFileAtomic,
} from '#system/utils/FileIO.mjs';
import { IArtAdminRepository } from '#apps/admin/ports/IArtAdminRepository.mjs';
import { ArtAdminRepositoryError, ArtAdminRepositoryErrorCode } from '#apps/admin/ports/ArtAdminRepositoryError.mjs';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const MAX_RATIO = 16 / 9;

const arrayValue = (value) => Array.isArray(value) ? value : (value == null ? [] : [value]);
const integerValue = (value) => Number.isFinite(Number(value)) ? Math.round(Number(value)) : null;
const encodeSegments = (value) => value.split('/').map(encodeURIComponent).join('/');

function normalizeCrop(raw) {
  if (raw == null || typeof raw !== 'object') return null;
  const numberValue = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
  return {
    enabled: raw.enabled === false ? false : true,
    top: numberValue(raw.top),
    bottom: numberValue(raw.bottom),
    left: numberValue(raw.left),
    right: numberValue(raw.right),
  };
}

function projectMetadata(document, section = null) {
  return {
    title: document.title ?? null,
    artist: document.artist ?? null,
    date: document.date != null ? String(document.date) : null,
    origin: document.origin ?? null,
    medium: document.medium ?? null,
    department: document.department ?? null,
    credit: document.credit ?? null,
    category: document.category ?? null,
    display: document.display ?? null,
    section,
    crop_anchor: document.crop_anchor ?? null,
    tags: arrayValue(document.tags),
    exclude: arrayValue(document.exclude),
    hidden: document.hidden === true,
    flagged: document.flagged === true,
    crop: normalizeCrop(document.crop),
    width: integerValue(document.width),
    height: integerValue(document.height),
  };
}

function artError(message, code) {
  return new ArtAdminRepositoryError(message, code);
}

/** Filesystem implementation of the Admin Art application's persistence port. */
export class FilesystemArtAdminRepository extends IArtAdminRepository {
  #imgBasePath;
  #householdDir;
  #logger;

  constructor({ mediaPath, householdDir = null, logger = console } = {}) {
    super();
    if (!mediaPath) throw new Error('FilesystemArtAdminRepository requires mediaPath');
    this.#imgBasePath = path.join(mediaPath, 'img');
    this.#householdDir = householdDir;
    this.#logger = logger;
  }

  async listWorks({ source } = {}) {
    const scope = this.#resolveScope(source);
    const entries = await this.#scanScope(scope);
    return entries.map(({ id, image, meta }) => ({ id, image, meta }));
  }

  async loadCollections() {
    if (!this.#householdDir) return {};
    const filePath = path.join(this.#householdDir, 'art', 'config.yml');
    try {
      const document = yaml.load(await readTextFromPathAsync(filePath)) || {};
      return document.collections || {};
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        this.#logger.warn?.('art.collections.read_failed', { error: error.message });
      }
      return {};
    }
  }

  async patchWorkMetadata({ source, id, patch }) {
    const scope = this.#resolveScope(source);
    const workDir = path.resolve(scope.dir, id);
    if (workDir === scope.dir || !workDir.startsWith(scope.dir + path.sep)) {
      throw artError('Invalid work id', ArtAdminRepositoryErrorCode.INVALID_WORK_ID);
    }
    const filePath = path.join(workDir, 'metadata.yaml');
    try {
      const document = yaml.load(await readTextFromPathAsync(filePath)) || {};
      for (const [key, value] of Object.entries(patch || {})) {
        if (value == null) delete document[key];
        else document[key] = value;
      }
      const serialized = yaml.dump(document, { lineWidth: -1 });
      writeFileAtomic(filePath, serialized);
      return document;
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw artError('Work not found', ArtAdminRepositoryErrorCode.WORK_NOT_FOUND);
      }
      throw error;
    }
  }

  #resolveScope(source) {
    const artRoot = path.resolve(this.#imgBasePath, 'art');
    const directory = path.resolve(this.#imgBasePath, source ? `art/${source}` : 'art/classic');
    if (directory !== artRoot && !directory.startsWith(artRoot + path.sep)) {
      throw artError('Invalid source', ArtAdminRepositoryErrorCode.INVALID_SOURCE);
    }
    return {
      key: source ? `art/${source}` : 'art/classic',
      dir: directory,
    };
  }

  async #scanScope(scope) {
    try {
      await getFileStatsAsync(scope.dir);
    } catch (error) {
      this.#logger.warn?.('art.scope.unreadable', { scope: scope.key, error: error.message });
      return [];
    }
    const childDirectories = (await readDirectoryAsync(scope.dir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const works = [];
    for (const child of childDirectories) {
      const direct = await this.#readWork(scope, child, null);
      if (direct) {
        works.push(direct);
        continue;
      }
      const sectionDir = path.join(scope.dir, child);
      let nestedDirectories;
      try {
        nestedDirectories = (await readDirectoryAsync(sectionDir, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name);
      } catch {
        continue;
      }
      for (const nested of nestedDirectories) {
        const work = await this.#readWork(scope, path.join(child, nested), child);
        if (work) works.push(work);
      }
    }
    return works;
  }

  async #readWork(scope, relativeFolder, section) {
    const directory = path.join(scope.dir, relativeFolder);
    let document;
    try {
      document = yaml.load(await readTextFromPathAsync(path.join(directory, 'metadata.yaml'))) || {};
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        this.#logger.warn?.('art.metadata.unreadable', { id: relativeFolder, error: error.message });
      }
      return null;
    }
    const meta = projectMetadata(document, section);
    if (!meta.width || !meta.height || meta.width / meta.height > MAX_RATIO) return null;
    const files = await readDirectoryAsync(directory);
    const imageFile = files.find((file) =>
      !file.startsWith('.') && IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()));
    if (!imageFile) {
      this.#logger.warn?.('art.image.missing', { folder: relativeFolder });
      return null;
    }
    return {
      id: relativeFolder,
      image: `/media/img/${encodeSegments(`${scope.key}/${relativeFolder}/${imageFile}`)}`,
      meta,
    };
  }
}

export default FilesystemArtAdminRepository;
