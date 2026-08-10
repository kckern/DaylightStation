import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const SEGMENT_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

export class YamlPianoAttemptStore {
  constructor({ usersDir, clock = () => new Date() }) {
    this.usersDir = usersDir;
    this.clock = clock;
  }

  save(userId, attempt) {
    if (!SEGMENT_RE.test(String(userId)) || !SEGMENT_RE.test(String(attempt?.attempt_id))) {
      throw new Error('invalid piano attempt identity');
    }
    const now = this.clock();
    const day = now.toISOString().slice(0, 10);
    const dir = path.join(this.usersDir, String(userId), 'apps', 'piano', 'attempts', day);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${attempt.attempt_id}.yml`);
    if (fs.existsSync(file)) {
      return YAML.parse(fs.readFileSync(file, 'utf8'), { uniqueKeys: true });
    }
    const record = { ...structuredClone(attempt), user_id: userId, created_at: now.toISOString() };
    fs.writeFileSync(file, YAML.stringify(record), { flag: 'wx' });
    return record;
  }

  listRecent(userId, { limit = 100 } = {}) {
    if (!SEGMENT_RE.test(String(userId))) return [];
    const root = path.join(this.usersDir, String(userId), 'apps', 'piano', 'attempts');
    if (!fs.existsSync(root)) return [];
    const files = fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
      .sort((a, b) => b.name.localeCompare(a.name))
      .flatMap((day) => fs.readdirSync(path.join(root, day.name))
        .filter((name) => name.endsWith('.yml'))
        .map((name) => path.join(root, day.name, name)));
    return files
      .map((file) => YAML.parse(fs.readFileSync(file, 'utf8'), { uniqueKeys: true }))
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      .slice(0, Math.max(0, limit));
  }
}
