import path from 'node:path';
import { ILanguageReelRepository } from '#apps/school/ports/ILanguageReelRepository.mjs';
import { createLocalFileResource } from '#system/http/streamFile.mjs';

const ID_RE = /^\d+$/;

export class FilesystemLanguageReelRepository extends ILanguageReelRepository {
  constructor({ configService, store }) {
    super();
    this.config = configService;
    this.store = store;
  }

  #root() { return path.join(this.config.getDataDir(), 'content', 'school', 'language', 'korean-language-reels'); }
  #reelFile(reelId) {
    if (!ID_RE.test(String(reelId))) return null;
    const root = path.join(this.#root(), 'reels');
    for (const category of this.store.list(root)) {
      const candidate = path.join(root, category, `${reelId}.reel.yml`);
      if (this.store.exists(candidate)) return { candidate, category };
    }
    return null;
  }
  #sessionFile(userId, reelId) {
    if (!this.config.getUserProfile?.(userId) || !ID_RE.test(String(reelId))) return null;
    return path.join(this.config.getUserDir(userId), 'apps', 'school', 'language-reels', `${reelId}.yml`);
  }
  #dailyFile(userId) {
    if (!this.config.getUserProfile?.(userId)) return null;
    return path.join(this.config.getUserDir(userId), 'apps', 'school', 'language-reels', 'daily-selections.yml');
  }

  findReel(reelId) {
    const found = this.#reelFile(reelId);
    return found ? { reel: this.store.read(found.candidate), bytes: this.store.readBytes(found.candidate), category: found.category } : null;
  }
  listReels() {
    const root = path.join(this.#root(), 'reels');
    const rows = [];
    for (const category of this.store.list(root)) {
      for (const name of this.store.list(path.join(root, category))) {
        if (name.endsWith('.reel.yml')) rows.push({ category, reelId: name.replace(/\.reel\.yml$/, '') });
      }
    }
    return rows;
  }
  readSession(userId, reelId) { const file = this.#sessionFile(userId, reelId); return file ? this.store.read(file) : undefined; }
  sessionExists(userId, reelId) { const file = this.#sessionFile(userId, reelId); return Boolean(file && this.store.exists(file)); }
  writeSession(userId, reelId, session) { const file = this.#sessionFile(userId, reelId); return file ? this.store.write(file, session) : null; }
  readDailySelections(userId) { const file = this.#dailyFile(userId); return file ? (this.store.read(file, {}) ?? {}) : undefined; }
  writeDailySelections(userId, selections) { const file = this.#dailyFile(userId); return file ? this.store.write(file, selections) : null; }
  resolveMediaResource(reel) {
    const parts = String(reel?.media?.assetId ?? '').replace(/^school:language\//, '').split('/');
    if (parts.length !== 3) return null;
    const [course, category, id] = parts;
    if (course !== 'korean-language-reels' || !/^[a-z0-9-]+$/.test(category) || !ID_RE.test(id)) return null;
    const file = path.join(this.config.getMediaDir(), 'school', 'language', course, category, `${id}.mp4`);
    return this.store.exists(file) ? createLocalFileResource(file, { mimeType: 'video/mp4' }) : null;
  }
}

export default FilesystemLanguageReelRepository;
