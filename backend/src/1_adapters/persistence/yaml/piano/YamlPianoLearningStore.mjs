import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const safe = (value) => typeof value === 'string' && ID_RE.test(value);
const safeContentId = (value) => typeof value === 'string' && value.length <= 256
  && !value.includes('/') && !value.includes('\\') && !value.includes('..');

function readYaml(file, fallback) {
  if (!fs.existsSync(file)) return structuredClone(fallback);
  const parsed = YAML.parse(fs.readFileSync(file, 'utf8'), { uniqueKeys: true });
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : structuredClone(fallback);
}

function writeAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const staging = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(staging, YAML.stringify(value));
  fs.renameSync(staging, file);
}

/**
 * Persistent learner choices and grown-up piano-program assignments.
 *
 * Learner-owned state stays with the user:
 *   data/users/{id}/apps/piano/learning.yml
 * Assignment policy stays with the household:
 *   data/household/apps/piano/program-assignments/{id}.yml
 */
export class YamlPianoLearningStore {
  constructor({ usersDir, assignmentsDir, clock = () => new Date() } = {}) {
    if (!usersDir || !assignmentsDir) throw new Error('YamlPianoLearningStore requires usersDir and assignmentsDir');
    this.usersDir = usersDir;
    this.assignmentsDir = assignmentsDir;
    this.clock = clock;
  }

  #learningFile(userId) {
    return path.join(this.usersDir, userId, 'apps', 'piano', 'learning.yml');
  }

  #assignmentFile(userId) {
    return path.join(this.assignmentsDir, `${userId}.yml`);
  }

  #historyFile(userId) {
    return path.join(this.assignmentsDir, '..', 'program-assignment-history', `${userId}.yml`);
  }

  getEnrollments(userId) {
    if (!safe(userId)) return [];
    const record = readYaml(this.#learningFile(userId), { enrollments: [] });
    return Array.isArray(record.enrollments) ? record.enrollments : [];
  }

  enroll(userId, programId) {
    if (!safe(userId) || !safe(programId)) throw new Error('invalid piano enrollment identity');
    const file = this.#learningFile(userId);
    const record = readYaml(file, { schema_version: 1, enrollments: [] });
    const existing = (record.enrollments ?? []).filter((entry) => entry?.programId !== programId);
    record.enrollments = [...existing, { programId, enrolledAt: this.clock().toISOString() }];
    record.updatedAt = this.clock().toISOString();
    writeAtomic(file, record);
    return record.enrollments;
  }

  unenroll(userId, programId) {
    if (!safe(userId) || !safe(programId)) throw new Error('invalid piano enrollment identity');
    const file = this.#learningFile(userId);
    const record = readYaml(file, { schema_version: 1, enrollments: [] });
    record.enrollments = (record.enrollments ?? []).filter((entry) => entry?.programId !== programId);
    record.updatedAt = this.clock().toISOString();
    writeAtomic(file, record);
    return record.enrollments;
  }

  getPendingCheckpoints(userId) {
    if (!safe(userId)) return [];
    const record = readYaml(this.#learningFile(userId), { pending_checkpoints: [] });
    return Array.isArray(record.pending_checkpoints) ? record.pending_checkpoints : [];
  }

  putPendingCheckpoint(userId, checkpoint) {
    if (!safe(userId) || !safeContentId(checkpoint?.contentId) || !checkpoint?.requirement?.exercise_id) {
      throw new Error('invalid piano checkpoint');
    }
    const file = this.#learningFile(userId);
    const record = readYaml(file, { schema_version: 1, enrollments: [], pending_checkpoints: [] });
    const previous = (record.pending_checkpoints ?? []).filter((entry) => entry.contentId !== checkpoint.contentId);
    record.pending_checkpoints = [...previous, { ...structuredClone(checkpoint), recordedAt: this.clock().toISOString() }];
    record.updatedAt = this.clock().toISOString();
    writeAtomic(file, record);
    return record.pending_checkpoints;
  }

  getAssignment(userId) {
    if (!safe(userId)) return null;
    return readYaml(this.#assignmentFile(userId), { learnerId: userId, programs: [], assignedBy: null, updatedAt: null });
  }

  putAssignment({ learnerId, programs, assignedBy, baseUpdatedAt = undefined }) {
    if (!safe(learnerId) || !safe(assignedBy) || !Array.isArray(programs) || programs.some((id) => !safe(id))) {
      throw new Error('invalid piano program assignment');
    }
    const current = this.getAssignment(learnerId);
    if (baseUpdatedAt !== undefined && (current?.updatedAt ?? null) !== baseUpdatedAt) {
      const error = new Error('Piano assignments changed since you loaded them — reload and try again.');
      error.code = 'STALE_SAVE';
      error.status = 409;
      throw error;
    }
    const now = this.clock().toISOString();
    const record = { schema_version: 1, learnerId, programs: [...new Set(programs)], assignedBy, updatedAt: now };
    const historyFile = this.#historyFile(learnerId);
    const historyRecord = readYaml(historyFile, { history: [] });
    const history = Array.isArray(historyRecord.history) ? historyRecord.history : [];
    writeAtomic(this.#assignmentFile(learnerId), record);
    writeAtomic(historyFile, { history: [...history, { ...record, recordedAt: now }] });
    return record;
  }
}

export default YamlPianoLearningStore;
