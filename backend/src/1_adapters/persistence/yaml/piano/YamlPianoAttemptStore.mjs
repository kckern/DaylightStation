import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const SEGMENT_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function attemptPayload(record) {
  const { user_id: ignoredUser, created_at: ignoredCreated, ...payload } = record || {};
  void ignoredUser;
  void ignoredCreated;
  return canonical(payload);
}

function idempotencyConflict(attemptId) {
  return Object.assign(new Error(`piano attempt idempotency conflict: ${attemptId}`), {
    code: 'idempotency_conflict',
    status: 409,
  });
}

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
    const existingFile = this.#findAttemptFile(userId, attempt.attempt_id);
    if (existingFile) return this.#resolveExisting(existingFile, attempt);
    const day = now.toISOString().slice(0, 10);
    const dir = path.join(this.usersDir, String(userId), 'apps', 'piano', 'attempts', day);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${attempt.attempt_id}.yml`);
    const record = { ...structuredClone(attempt), user_id: userId, created_at: now.toISOString() };
    try {
      fs.writeFileSync(file, YAML.stringify(record), { flag: 'wx' });
    } catch (error) {
      if (error?.code === 'EEXIST') return this.#resolveExisting(file, attempt);
      throw error;
    }
    return record;
  }

  #findAttemptFile(userId, attemptId) {
    const root = path.join(this.usersDir, String(userId), 'apps', 'piano', 'attempts');
    if (!fs.existsSync(root)) return null;
    const filename = `${attemptId}.yml`;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue;
      const candidate = path.join(root, entry.name, filename);
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  }

  #resolveExisting(file, attempt) {
    const existing = YAML.parse(fs.readFileSync(file, 'utf8'), { uniqueKeys: true });
    if (JSON.stringify(attemptPayload(existing)) !== JSON.stringify(attemptPayload(attempt))) {
      throw idempotencyConflict(attempt?.attempt_id);
    }
    return existing;
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

  list(userId, { limit = 1000, exerciseId = null, purpose = null, context = null } = {}) {
    return this.listRecent(userId, { limit: Math.max(limit, 1000) })
      .filter((attempt) => !exerciseId || (attempt.prompt?.exercise_id ?? attempt.exercise_id) === exerciseId)
      .filter((attempt) => !purpose || (attempt.purpose ?? (attempt.challenge_id ? 'challenge' : 'practice')) === purpose)
      .filter((attempt) => !context || attempt.context?.surface === context)
      .slice(0, Math.max(0, limit));
  }
}
