import fs from 'node:fs';
import path from 'node:path';
import { ILearningEvidenceRepository } from '#apps/school/ports/ILearningEvidenceRepository.mjs';
import { validateLearningEvidence } from '#domains/school/progress/index.mjs';
import { ensureDir, loadYamlSafe, saveYaml } from '#system/utils/FileIO.mjs';

const DAY_FILE = /^\d{4}-\d{2}-\d{2}\.yml$/;

/** Date-sharded append-only repository for non-attempt School evidence. */
export class YamlLearningEvidenceRepository extends ILearningEvidenceRepository {
  #config;

  constructor({ configService } = {}) {
    super();
    if (!configService || typeof configService.getUserDir !== 'function') {
      throw new Error('YamlLearningEvidenceRepository requires configService');
    }
    this.#config = configService;
  }

  appendEvidence(raw) {
    const result = validateLearningEvidence(raw);
    if (result.errors.length) throw new Error(`Cannot persist School learning evidence: ${result.errors.join('; ')}`);
    const evidence = result.evidence;
    const directory = this.#directory(evidence.learnerId);
    if (!directory) throw new Error(`Cannot persist School evidence for unknown learner '${evidence.learnerId}'`);
    const existing = this.#readAll(directory).find((entry) => entry.evidenceId === evidence.evidenceId);
    if (existing) {
      if (stableValue(existing) !== stableValue(evidence)) {
        const error = new Error(`School learning evidence '${evidence.evidenceId}' conflicts with its first write`);
        error.code = 'LEARNING_EVIDENCE_CONFLICT';
        throw error;
      }
      return { status: 'duplicate', evidence: structuredClone(existing) };
    }
    ensureDir(directory);
    const day = evidence.occurredAt.slice(0, 10);
    const file = path.join(directory, day);
    const list = loadYamlSafe(file) || [];
    if (!Array.isArray(list)) throw new Error(`School learning evidence day '${day}' is corrupt`);
    list.push(evidence);
    saveYaml(file, list, { noRefs: true });
    return { status: 'recorded', evidence: structuredClone(evidence) };
  }

  listEvidence({ learnerIds, from = null, to = null } = {}) {
    if (!Array.isArray(learnerIds)) throw new Error('School learning evidence query requires learnerIds');
    return learnerIds.flatMap((learnerId) => {
      const directory = this.#directory(learnerId);
      return directory ? this.#readAll(directory) : [];
    }).filter((entry) => (from === null || entry.occurredAt >= from)
      && (to === null || entry.occurredAt < to))
      .map((entry) => structuredClone(entry));
  }

  #directory(learnerId) {
    if (!this.#config.getUserProfile?.(learnerId)) return null;
    return path.join(this.#config.getUserDir(learnerId), 'apps', 'school', 'learning-evidence');
  }

  #readAll(directory) {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory)
      .filter((file) => DAY_FILE.test(file))
      .sort()
      .flatMap((file) => {
        const rows = loadYamlSafe(path.join(directory, file.replace(/\.yml$/, ''))) || [];
        if (!Array.isArray(rows)) throw new Error(`School learning evidence file '${file}' is corrupt`);
        return rows;
      });
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export default YamlLearningEvidenceRepository;

