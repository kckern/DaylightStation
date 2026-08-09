import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const SESSION_ID_RE = /^game_[a-zA-Z0-9-]{8,80}$/;

export class GamingRevisionConflictError extends Error {
  constructor(currentRevision) {
    super('gaming session revision conflict');
    this.name = 'GamingRevisionConflictError';
    this.currentRevision = currentRevision;
  }
}

export class YamlGamingSessionStore {
  constructor({ sessionsDir }) {
    this.sessionsDir = sessionsDir;
    fs.mkdirSync(this.sessionsDir, { recursive: true });
  }

  #file(sessionId) {
    if (!SESSION_ID_RE.test(String(sessionId))) return null;
    return path.join(this.sessionsDir, `${sessionId}.yml`);
  }

  #write(session) {
    const file = this.#file(session.session_id);
    if (!file) throw new Error('invalid gaming session id');
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, YAML.stringify(session), { flag: 'wx' });
    fs.renameSync(temporary, file);
    return structuredClone(session);
  }

  create(session) {
    const file = this.#file(session.session_id);
    if (!file) throw new Error('invalid gaming session id');
    if (fs.existsSync(file)) throw new Error('gaming session already exists');
    return this.#write(session);
  }

  get(sessionId) {
    const file = this.#file(sessionId);
    if (!file || !fs.existsSync(file)) return null;
    return YAML.parse(fs.readFileSync(file, 'utf8'), { uniqueKeys: true });
  }

  compareAndSwap(session, expectedRevision) {
    const current = this.get(session.session_id);
    if (!current) throw new Error('gaming session not found');
    if (current.revision !== expectedRevision) throw new GamingRevisionConflictError(current.revision);
    return this.#write(session);
  }
}
