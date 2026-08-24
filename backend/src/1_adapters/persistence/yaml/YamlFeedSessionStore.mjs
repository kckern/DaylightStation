import fs from 'node:fs';
import path from 'node:path';

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
    if (!fs.existsSync(dir)) return;
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const filename of fs.readdirSync(dir)) {
      const target = path.join(dir, filename);
      try {
        if (fs.statSync(target).isFile() && fs.statSync(target).mtimeMs < cutoff) fs.unlinkSync(target);
      } catch {
        // A concurrent cleanup may have already removed the file.
      }
    }
  }
}

export default YamlFeedSessionStore;
