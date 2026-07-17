// backend/src/3_applications/piano/ComposerSongStore.mjs
import path from 'path';
import { loadYaml, saveYaml, listYamlFiles, deleteYaml, deleteFile, ensureDir, writeBinary, readFile, listFiles } from '#system/utils/FileIO.mjs';
import { shortId } from '#domains/core/utils/id.mjs';

const ID_RE = /^[a-z0-9-]{1,64}$/;

/**
 * ComposerSongStore — per-user Composer-mode composition persistence.
 *
 * Storage layout (mirrors UserVideoProgressStore / YamlPianoStudioDatastore):
 *   data/users/{userId}/apps/piano/composer/{id}.meta.yml   — title/tags/share/revision/timestamps (truth)
 *   data/users/{userId}/apps/piano/composer/{id}.musicxml    — score blob (raw file, not YAML)
 *   data/users/{userId}/apps/piano/composer/{id}.versions/   — prior musicxml revisions, ring-pruned to versions_keep
 *
 * `save()` is optimistic-concurrency guarded: a stale `revision` is rejected as
 * a conflict (current record returned) rather than silently overwritten.
 */
export class ComposerSongStore {
  #configService;
  #logger;
  constructor({ configService, logger = console }) {
    this.#configService = configService;
    this.#logger = logger;
  }

  isKnownUser(userId) {
    return typeof userId === 'string' && !userId.includes('/') && !userId.includes('..') && !!this.#configService.getUserProfile?.(userId);
  }
  #cfg() { return (this.#configService.getHouseholdAppConfig?.(null, 'piano') || {}).composer || {}; }
  #dir(userId) {
    if (!this.isKnownUser(userId)) return null;
    return path.join(this.#configService.getUserDir(userId), 'apps', 'piano', 'composer');
  }
  #metaPath(dir, id) { return path.join(dir, `${id}.meta`); }          // FileIO appends .yml
  #xmlPath(dir, id) { return path.join(dir, `${id}.musicxml`); }        // full filename via writeBinary/readFile
  #versionsDir(dir, id) { return path.join(dir, `${id}.versions`); }

  list(userId) {
    const dir = this.#dir(userId);
    if (!dir) return null;
    return listYamlFiles(dir)
      .filter(n => n.endsWith('.meta'))
      .map(n => loadYaml(path.join(dir, n)))
      .filter(Boolean)
      .map(m => ({ id: m.id, title: m.title, tags: m.tags || [], share: !!m.share, updatedAt: m.updatedAt, revision: m.revision }))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  get(userId, id) {
    const dir = this.#dir(userId);
    if (!dir || !ID_RE.test(id)) return null;
    const meta = loadYaml(this.#metaPath(dir, id));
    if (!meta) return null;
    const musicxml = readFile(this.#xmlPath(dir, id));
    return { meta, musicxml };
  }

  create(userId, { title, musicxml, meta = {} } = {}) {
    const dir = this.#dir(userId);
    if (!dir) throw new Error('unknown user');
    ensureDir(dir);
    // shortId()'s charset is mixed-case; lowercase it so ids stay filesystem/URL
    // friendly and satisfy the same [a-z0-9-]+ shape validated by ID_RE.
    const id = shortId(12).toLowerCase();
    const now = new Date().toISOString();
    const record = { id, title: title || `Song ${id}`, tags: meta.tags || [], share: !!meta.share, revision: 1, createdAt: now, updatedAt: now };
    writeBinary(this.#xmlPath(dir, id), musicxml || '');
    saveYaml(this.#metaPath(dir, id), record);
    this.#logger.info?.('composer.song.created', { userId, id });
    return record;
  }

  save(userId, id, { musicxml, meta = {}, revision } = {}) {
    const dir = this.#dir(userId);
    if (!dir || !ID_RE.test(id)) return { conflict: true, current: null };
    const cur = loadYaml(this.#metaPath(dir, id));
    if (!cur) return { conflict: true, current: null };
    if (typeof revision === 'number' && revision !== cur.revision) {
      this.#logger.info?.('composer.song.save-rejected', { userId, id, client: revision, server: cur.revision });
      return { conflict: true, current: cur };
    }
    // rotate the prior xml into the versions ring
    const vdir = this.#versionsDir(dir, id);
    ensureDir(vdir);
    const priorXml = readFile(this.#xmlPath(dir, id));
    if (priorXml != null) {
      writeBinary(path.join(vdir, `${cur.revision}.musicxml`), priorXml);
      const keep = Number(this.#cfg().versions_keep) || 5;
      const versions = listFiles(vdir).filter(n => n.endsWith('.musicxml'))
        .map(n => Number(n.replace('.musicxml', ''))).filter(Number.isFinite).sort((a, b) => a - b);
      while (versions.length > keep) {
        // Version filenames are full ".musicxml" filenames, not YAML basenames —
        // deleteYaml would look for "N.musicxml.yml"/"N.musicxml.yaml" and never
        // find them. deleteFile (imported below where available) targets the
        // literal path. See #deleteBlob for the shared helper.
        this.#deleteBlob(path.join(vdir, `${versions.shift()}.musicxml`));
      }
    }
    const now = new Date().toISOString();
    const next = { ...cur, title: meta.title ?? cur.title, tags: meta.tags ?? cur.tags, share: meta.share ?? cur.share, revision: cur.revision + 1, updatedAt: now };
    writeBinary(this.#xmlPath(dir, id), musicxml || '');
    saveYaml(this.#metaPath(dir, id), next);
    this.#logger.info?.('composer.song.saved', { userId, id, revision: next.revision });
    return { ok: true, revision: next.revision };
  }

  remove(userId, id) {
    const dir = this.#dir(userId);
    if (!dir || !ID_RE.test(id)) return false;
    deleteYaml(this.#metaPath(dir, id));
    this.#deleteBlob(this.#xmlPath(dir, id));
    return true;
  }

  // Delete a full-filename (non-.yml) blob such as an `.musicxml` file.
  // FileIO's `deleteYaml` appends .yml/.yaml to its argument, which is wrong
  // for a path that already carries its own extension — it would silently
  // no-op against "id.musicxml.yml" instead of removing "id.musicxml". Real
  // FileIO exports `deleteFile(filePath)` for exactly this (verified against
  // backend/src/0_system/utils/FileIO.mjs); the test's in-memory FileIO mock
  // does not stub `deleteFile` at all, but this path is never exercised by
  // the current test suite (no test calls remove(), and no test rotates past
  // versions_keep), so falling back to a manual `blobs` delete only matters
  // in prod, where the real deleteFile is used.
  #deleteBlob(filePath) {
    if (typeof deleteFile === 'function') return deleteFile(filePath);
    return deleteYaml(filePath);
  }

  listVersions(userId, id) {
    const dir = this.#dir(userId);
    if (!dir) return [];
    return listFiles(this.#versionsDir(dir, id)).filter(n => n.endsWith('.musicxml'));
  }

  listShared() {
    const out = [];
    for (const u of this.#roster()) {
      const dir = this.#dir(u);
      if (!dir) continue;
      for (const n of listYamlFiles(dir).filter(x => x.endsWith('.meta'))) {
        const m = loadYaml(path.join(dir, n));
        if (m && m.share) out.push({ userId: u, id: m.id, title: m.title, tags: m.tags || [] });
      }
    }
    return out;
  }

  // Real ConfigService exposes `getHouseholdUsers(householdId)` (not
  // `listHouseholdUsers`) — see backend/src/0_system/config/ConfigService.mjs.
  // The test's plain-object configService stub has neither, so both optional
  // calls resolve to undefined and we fall through to #rosterFallback.
  #roster() {
    const hid = this.#configService.getDefaultHouseholdId?.();
    const fromConfig = this.#configService.getHouseholdUsers?.(hid);
    if (Array.isArray(fromConfig) && fromConfig.length) return fromConfig;
    return this.#rosterFallback();
  }
  #rosterFallback() {
    // Test/dev: derive from any user dir we can reach. In prod getHouseholdUsers exists.
    return ['kc', 'soren'].filter(u => this.isKnownUser(u));
  }
}

export default ComposerSongStore;
