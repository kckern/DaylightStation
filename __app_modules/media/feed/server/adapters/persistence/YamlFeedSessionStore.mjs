import path from 'node:path';
import { deleteFile, fileExists, getStats, listEntries } from '#system/utils/FileIO.mjs';

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export class YamlFeedSessionStore {
  #dataService;
  #prunedUsers = new Set();

  constructor({ dataService }) {
    this.#dataService = dataService;
  }

  load(username, sessionId) {
    this.#prune(username);
    const value = this.#dataService.user.read(`feed/sessions/${sessionId}`, username);
    if (!value || Date.now() - new Date(value.updatedAt || value.createdAt || 0).getTime() > SESSION_TTL_MS) return null;
    return value;
  }

  save(username, sessionId, snapshot) {
    this.#prune(username);
    const previous = this.#dataService.user.read(`feed/sessions/${sessionId}`, username);
    return this.#dataService.user.write(`feed/sessions/${sessionId}`, {
      version: 1,
      createdAt: previous?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      snapshot,
    }, username);
  }


  #prune(username) {
    if (this.#prunedUsers.has(username)) return;
    this.#prunedUsers.add(username);
    const dir = this.#dataService.user.resolveDir('feed/sessions', username);
    const cutoff = Date.now() - SESSION_TTL_MS;
    if (!fileExists(dir)) return;
    for (const filename of listEntries(dir)) {
      const target = path.join(dir, filename);
      try {
        const stats = getStats(target);
        if (stats?.isFile() && stats.mtimeMs < cutoff) deleteFile(target);
      } catch {
        // A concurrent cleanup may have already removed the file.
      }
    }
  }
}

export default YamlFeedSessionStore;
