import path from 'node:path';
import crypto from 'node:crypto';
import * as FileIO from '#system/utils/FileIO.mjs';
import { workHash, stableWorkJson } from '../domain/workState.mjs';
const identifier = value => {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value ?? '')) throw new TypeError('Invalid checkpoint identifier');
  return value;
};
const digest = value => /^[a-f0-9]{64}$/.test(value ?? '');
const statuses = ['complete', 'saturated', 'failed', 'budget_blocked'];
// Shared artifact contract uses Unicode key ordering, independently of host locale.
const resultHash = value => crypto.createHash('sha256').update(JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)).digest('hex');
const conflict = () => {
  throw new Error('Backfill checkpoint conflict');
};
const readOptional = filename => {
  try {
    return FileIO.readTextFromPath(filename);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};

/** Private job artifacts only. No household state, authority or provider ports. */
export class WorkBackfillCheckpoint {
  #root;
  constructor({
    outputDir,
    dataDir
  }) {
    const root = FileIO.resolveRealPath(outputDir),
      data = FileIO.resolveRealPath(dataDir);
    if (!root || !data || !FileIO.getFileStats(root).isDirectory()) throw new Error('Checkpoint directory must exist outside data');
    const relative = path.relative(data, root);
    if (!relative || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) throw new Error('Checkpoint directory must be outside data');
    this.#root = root;
  }
  #file(jobId) {
    return path.join(this.#root, identifier(jobId) + '.checkpoints.jsonl');
  }
  #validate(row) {
    identifier(row.jobId);
    identifier(row.chunkId);
    if (!digest(row.sourceDigest) || !digest(row.resultDigest) || !statuses.includes(row.status)) throw new TypeError('Invalid checkpoint record');
  }
  async read({
    jobId
  }) {
    const text = readOptional(this.#file(jobId));
    const chunks = {};
    if (text == null || text === '') return {
      chunks
    };
    if (!text.endsWith('\n')) throw new Error('Corrupt checkpoint tail');
    for (const line of text.slice(0, -1).split('\n')) {
      let envelope;
      try {
        envelope = JSON.parse(line);
        this.#validate(envelope.record);
      } catch {
        throw new Error('Corrupt checkpoint record');
      }
      const row = envelope.record;
      if (envelope.checksum !== workHash(row) || row.jobId !== jobId) throw new Error('Corrupt checkpoint checksum');
      const previous = chunks[row.chunkId];
      if (previous && (previous.sourceDigest !== row.sourceDigest || previous.status === 'complete' && stableWorkJson(previous) !== stableWorkJson(row))) conflict();
      chunks[row.chunkId] = row;
    }
    return {
      chunks
    };
  }
  async append({
    jobId,
    chunkId,
    sourceDigest,
    resultDigest,
    status
  }) {
    const record = {
      jobId,
      chunkId,
      sourceDigest,
      resultDigest,
      status
    };
    this.#validate(record);
    const previous = (await this.read({
      jobId
    })).chunks[chunkId];
    if (previous) {
      if (stableWorkJson(previous) === stableWorkJson(record)) return {
        applied: false
      };
      if (previous.sourceDigest !== sourceDigest || previous.status === 'complete') conflict();
    }
    FileIO.appendTextFile(this.#file(jobId), JSON.stringify({
      record,
      checksum: workHash(record)
    }) + '\n', {
      durable: true
    });
    return {
      applied: true
    };
  }
  #chunkFile(jobId, chunkId) {
    return path.join(this.#root, identifier(jobId) + '.' + identifier(chunkId) + '.result.json');
  }
  async readChunk({
    jobId,
    chunkId,
    sourceDigest
  }) {
    const text = readOptional(this.#chunkFile(jobId, chunkId));
    if (text == null) return null;
    let record;
    try {
      record = JSON.parse(text);
    } catch {
      throw new Error('Corrupt chunk result');
    }
    if (record.jobId !== jobId || record.chunkId !== chunkId || record.sourceDigest !== sourceDigest) conflict();
    if (!digest(sourceDigest) || record.resultDigest !== resultHash(record.result)) throw new Error('Corrupt chunk result digest');
    return record;
  }
  async writeChunk({
    jobId,
    chunkId,
    sourceDigest,
    result
  }) {
    identifier(jobId);
    identifier(chunkId);
    if (!digest(sourceDigest)) throw new TypeError('Invalid chunk source digest');
    const record = {
      jobId,
      chunkId,
      sourceDigest,
      result,
      resultDigest: resultHash(result)
    };
    const filename = this.#chunkFile(jobId, chunkId);
    try {
      FileIO.writeFileExclusive(filename, JSON.stringify(record) + '\n', {
        mode: 0o600
      });
      FileIO.appendTextFile(filename, '', {
        durable: true
      });
      return record;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const previous = await this.readChunk({
        jobId,
        chunkId,
        sourceDigest
      });
      if (previous.resultDigest !== record.resultDigest) conflict();
      return previous;
    }
  }
}
