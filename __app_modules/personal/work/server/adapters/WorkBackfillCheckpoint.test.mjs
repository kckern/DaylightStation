import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { WorkBackfillCheckpoint } from './WorkBackfillCheckpoint.mjs';
let root, dataDir, outputDir;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'work-backfill-'));
  dataDir = path.join(root, 'data');
  outputDir = path.join(root, 'private');
  fs.mkdirSync(dataDir);
  fs.mkdirSync(outputDir);
});
afterEach(() => fs.rmSync(root, {
  recursive: true,
  force: true
}));
const input = {
  jobId: 'job-1',
  chunkId: 'chunk-1',
  sourceDigest: 'a'.repeat(64),
  resultDigest: 'b'.repeat(64),
  status: 'complete'
};
describe('private backfill checkpoints', () => {
  it('durably replays one completion and rejects source/result replacement', async () => {
    const first = new WorkBackfillCheckpoint({
      outputDir,
      dataDir
    });
    expect((await first.append(input)).applied).toBe(true);
    const next = new WorkBackfillCheckpoint({
      outputDir,
      dataDir
    });
    expect((await next.append(input)).applied).toBe(false);
    await expect(next.append({
      ...input,
      sourceDigest: 'c'.repeat(64)
    })).rejects.toThrow(/conflict/i);
    await expect(next.append({
      ...input,
      resultDigest: 'c'.repeat(64)
    })).rejects.toThrow(/conflict/i);
    expect((await next.read({
      jobId: input.jobId
    })).chunks[input.chunkId]).toEqual(input);
    expect(fs.readdirSync(dataDir)).toEqual([]);
  });
  it('retains a model result before the checkpoint so restart needs no additional call', async () => {
    const first = new WorkBackfillCheckpoint({
      outputDir,
      dataDir
    });
    const result = {
      proposals: [],
      modelVersion: 'fixture'
    };
    const saved = await first.writeChunk({
      ...input,
      result
    });
    const next = new WorkBackfillCheckpoint({
      outputDir,
      dataDir
    });
    expect((await next.readChunk(input)).result).toEqual(result);
    expect((await next.writeChunk({
      ...input,
      result
    })).resultDigest).toBe(saved.resultDigest);
    await expect(next.writeChunk({
      ...input,
      result: {
        proposals: [{
          bogus: true
        }]
      }
    })).rejects.toThrow(/conflict/i);
  });
  it('uses locale-independent Unicode key ordering for the shared result digest', async () => {
    const checkpoint = new WorkBackfillCheckpoint({
      outputDir,
      dataDir
    });
    const saved = await checkpoint.writeChunk({
      ...input,
      result: {
        a: 2,
        A: 1
      }
    });
    expect(saved.resultDigest).toBe(crypto.createHash('sha256').update('{"A":1,"a":2}').digest('hex'));
  });
  it('refuses output inside data, symlink aliases and traversal identifiers before writing', async () => {
    expect(() => new WorkBackfillCheckpoint({
      outputDir: dataDir,
      dataDir
    })).toThrow(/outside/i);
    const alias = path.join(root, 'alias');
    fs.symlinkSync(dataDir, alias);
    expect(() => new WorkBackfillCheckpoint({
      outputDir: alias,
      dataDir
    })).toThrow(/outside/i);
    const checkpoint = new WorkBackfillCheckpoint({
      outputDir,
      dataDir
    });
    await expect(checkpoint.append({
      ...input,
      jobId: '../escape'
    })).rejects.toThrow(/identifier/i);
    expect(fs.readdirSync(outputDir)).toEqual([]);
  });
  it('fails closed on a torn or edited checkpoint instead of silently rerunning chunks', async () => {
    const checkpoint = new WorkBackfillCheckpoint({
      outputDir,
      dataDir
    });
    await checkpoint.append(input);
    const file = path.join(outputDir, 'job-1.checkpoints.jsonl');
    fs.appendFileSync(file, '{"partial":');
    await expect(checkpoint.read({
      jobId: input.jobId
    })).rejects.toThrow(/corrupt/i);
  });
});
