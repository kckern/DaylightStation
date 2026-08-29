const ANCHOR_KEYWORDS = new Set(['top', 'bottom', 'left', 'right', 'center']);
const WRITABLE_FIELDS = new Set([
  'title', 'artist', 'date', 'medium', 'category', 'display',
  'crop_anchor', 'tags', 'exclude', 'hidden', 'flagged', 'crop',
]);

function isValidAnchor(anchor) {
  if (anchor == null) return true;
  if (typeof anchor !== 'string') return false;
  const tokens = anchor.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length < 1 || tokens.length > 2) return false;
  return tokens.every((token) => ANCHOR_KEYWORDS.has(token) || /^\d{1,3}%$/.test(token));
}

function isValidCrop(crop) {
  if (crop == null) return true;
  if (typeof crop !== 'object' || Array.isArray(crop)) return false;
  if ('enabled' in crop && typeof crop.enabled !== 'boolean') return false;
  const validSide = (value) => value == null
    || (typeof value === 'number' && value >= 0 && value <= 90);
  for (const key of ['top', 'bottom', 'left', 'right']) {
    if (key in crop && !validSide(crop[key])) return false;
  }
  if ((Number(crop.top) || 0) + (Number(crop.bottom) || 0) > 90) return false;
  if ((Number(crop.left) || 0) + (Number(crop.right) || 0) > 90) return false;
  return true;
}

function parseYear(value) {
  if (value == null) return null;
  const match = String(value).match(/\d{4}/);
  if (!match) return null;
  const year = Number(match[0]);
  return year > 0 ? year : null;
}

const includesCI = (value, expected) =>
  String(value ?? '').toLowerCase().includes(String(expected).toLowerCase());

function matchesCollection(key, definition = {}, work) {
  const meta = work?.meta || {};
  if (Array.isArray(meta.tags) && meta.tags.includes(key)) return true;
  if (definition.dateMin != null || definition.dateMax != null) {
    const year = parseYear(meta.date);
    if (year == null) return false;
    if (definition.dateMin != null && year < definition.dateMin) return false;
    if (definition.dateMax != null && year > definition.dateMax) return false;
  }
  for (const field of ['origin', 'medium', 'artist', 'department', 'category', 'display', 'section']) {
    if (definition[field] != null && !includesCI(meta[field], definition[field])) return false;
  }
  if (Array.isArray(definition.works) && definition.works.length > 0) {
    return definition.works.includes(work.id);
  }
  return true;
}

function filterWorks(works, { hidden, flagged, q } = {}) {
  const needle = q ? String(q).toLowerCase() : null;
  return works.filter((work) => {
    const meta = work.meta || {};
    if (hidden === true && meta.hidden !== true) return false;
    if (flagged === true && meta.flagged !== true) return false;
    if (needle) {
      const haystack = `${meta.title ?? ''} ${meta.artist ?? ''}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

function invalidPatch(message) {
  const error = new Error(message);
  error.code = 'ART_ADMIN_INVALID_PATCH';
  return error;
}

/** Application orchestration for classic file-backed art curation. */
export class AdminArtService {
  #repository;
  #logger;
  #collections = null;

  constructor({ repository, logger = console } = {}) {
    if (!repository
      || typeof repository.listWorks !== 'function'
      || typeof repository.loadCollections !== 'function'
      || typeof repository.patchWorkMetadata !== 'function') {
      throw new Error('AdminArtService requires repository');
    }
    this.#repository = repository;
    this.#logger = logger;
  }

  async listWorks({ source, tag, hidden, flagged, q, page = 1, pageSize = 60 } = {}) {
    let works = await this.#repository.listWorks({ source });
    if (tag) {
      const collections = await this.#getCollections();
      works = Object.prototype.hasOwnProperty.call(collections, tag)
        ? works.filter((work) => matchesCollection(tag, collections[tag] || {}, work))
        : works.filter((work) => Array.isArray(work.meta?.tags) && work.meta.tags.includes(tag));
    }
    const filtered = filterWorks(works, { hidden, flagged, q });
    const start = (page - 1) * pageSize;
    return {
      total: filtered.length,
      page,
      pageSize,
      works: filtered.slice(start, start + pageSize),
    };
  }

  async patchWork({ source, id, patch = {} }) {
    if ('crop_anchor' in patch && !isValidAnchor(patch.crop_anchor)) {
      throw invalidPatch(`Invalid crop_anchor: ${patch.crop_anchor}`);
    }
    if ('crop' in patch && !isValidCrop(patch.crop)) {
      throw invalidPatch(`Invalid crop: ${JSON.stringify(patch.crop)}`);
    }
    const writablePatch = Object.fromEntries(
      Object.entries(patch).filter(([key]) => WRITABLE_FIELDS.has(key)),
    );
    const meta = await this.#repository.patchWorkMetadata({ source, id, patch: writablePatch });
    this.#logger.info?.('admin.art.patched', { id, fields: Object.keys(patch) });
    return { ok: true, id, meta };
  }

  async #getCollections() {
    if (this.#collections) return this.#collections;
    try {
      this.#collections = await this.#repository.loadCollections();
    } catch (error) {
      this.#logger.warn?.('admin.art.collections.load_failed', { error: error.message });
      this.#collections = {};
    }
    return this.#collections;
  }
}

export default AdminArtService;
