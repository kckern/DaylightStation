import { it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { createKnowledgeImportRuntime } from './knowledge-import.mjs';
import { importDigest } from '../domain/knowledge/importManifest.mjs';
it('keeps disabled composition inert', () => {
  const loadJournal = vi.fn();
  const runtime = createKnowledgeImportRuntime({
    configuration: {
      enabled: false
    },
    loadJournal
  });
  expect(runtime.prepare).toBeNull();
  expect(loadJournal).not.toHaveBeenCalled();
});
it('does not construct AI or read credentials for a prepare-only or empty preview job', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-lazy-import-'));
  const dataDir = path.join(tmp, 'data');
  fs.mkdirSync(dataDir);
  const gatewayFactory = vi.fn(),
    asOf = Date.parse('2026-11-17T18:00Z');
  let runtime;
  try {
    runtime = createKnowledgeImportRuntime({
      configuration: {
        enabled: true,
        write: false,
        importWrites: false
      },
      dataDir,
      rootForUser: u => path.join(dataDir, u, 'knowledge'),
      checkpoint: {
        writeChunk: async () => {},
        read: async () => ({
          chunks: {}
        })
      },
      loadJournal: async () => ({
        messages: []
      }),
      identityForUser: async () => ({
        senderId: 'author',
        conversationId: 'private'
      }),
      userTimezone: () => 'America/Los_Angeles',
      clock: () => asOf,
      gatewayFactory
    });
    const {
      manifest
    } = await runtime.prepare({
      username: 'sample',
      from: asOf - 90 * 86400000,
      asOf,
      jobId: 'job-1'
    });
    expect((await runtime.resume({
      manifest,
      usageDir: tmp
    })).report.complete).toBe(true);
    expect(gatewayFactory).not.toHaveBeenCalled();
    expect(fs.readdirSync(dataDir)).toEqual([]);
  } finally {
    await runtime?.dispose();
    fs.rmSync(tmp, {
      recursive: true,
      force: true
    });
  }
});
it('previews without data writes, then uses actual operator authority and KB lease to import quietly once', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-import-'));
  const dataDir = path.join(tmp, 'data'),
    usageDir = path.join(tmp, 'private');
  fs.mkdirSync(dataDir);
  fs.mkdirSync(usageDir);
  const caches = new Map(),
    checkpoints = new Map();
  const checkpoint = {
    read: async ({
      jobId
    }) => ({
      chunks: Object.fromEntries([...checkpoints.values()].filter(row => row.jobId === jobId).map(row => [row.chunkId, row]))
    }),
    append: async row => {
      checkpoints.set(row.jobId + ':' + row.chunkId, row);
    },
    readChunk: async ({
      jobId,
      chunkId
    }) => caches.get(jobId + ':' + chunkId),
    writeChunk: async row => {
      const value = {
        ...row,
        resultDigest: importDigest(row.result)
      };
      caches.set(row.jobId + ':' + row.chunkId, value);
      return value;
    }
  };
  const asOf = Date.parse('2026-11-17T18:00Z');
  const rows = [{
    id: 'journal-1',
    senderId: 'author',
    timestamp: '2026-10-01T18:00Z',
    content: 'I will finish the family story.'
  }];
  const extractor = {
    extract: vi.fn(async ({
      messages
    }) => ({
      proposals: [{
        id: 'proposal-1',
        op: 'open_loop',
        target: 'loop.family-story',
        evidenceRef: messages[0].ref,
        quote: messages[0].content,
        fields: {
          title: 'Finish the family story'
        }
      }],
      modelVersion: 'fixture'
    }))
  };
  const rootForUser = username => path.join(dataDir, username, 'lifelog', 'knowledge');
  const runtime = createKnowledgeImportRuntime({
    configuration: {
      enabled: true,
      write: true,
      importWrites: true,
      operator_uid: process.getuid(),
      writer_env: process.env.DAYLIGHT_ENV || 'docker',
      writer_host: os.hostname()
    },
    rootForUser,
    dataDir,
    checkpoint,
    extractor,
    loadJournal: async () => ({
      messages: rows
    }),
    identityForUser: async () => ({
      senderId: 'author',
      conversationId: 'private'
    }),
    userTimezone: () => 'America/Los_Angeles',
    clock: () => asOf
  });
  try {
    const {
      manifest
    } = await runtime.prepare({
      username: 'sample',
      jobId: 'job-1',
      from: asOf - 90 * 86400000,
      asOf
    });
    const {
      artifact
    } = await runtime.resume({
      manifest,
      usageDir
    });
    expect(fs.readdirSync(dataDir)).toEqual([]);
    expect(fs.readdirSync(usageDir)).toHaveLength(1);
    await expect(runtime.commit({
      manifest,
      artifact,
      operatorReceipt: {
        approved: true
      }
    })).rejects.toMatchObject({
      code: 'KNOWLEDGE_IMPORT_DENIED'
    });
    const operatorReceipt = runtime.captureOperatorReceipt({
      manifest
    });
    expect((await runtime.commit({
      manifest,
      artifact,
      operatorReceipt
    })).applied).toBe(true);
    expect((await runtime.commit({
      manifest,
      artifact,
      operatorReceipt
    })).applied).toBe(false);
    const files = fs.readdirSync(path.join(rootForUser('sample'), 'loops'));
    const object = yaml.load(fs.readFileSync(path.join(rootForUser('sample'), 'loops', files[0]), 'utf8'));
    expect(object).toMatchObject({
      ask_policy: 'user_initiated',
      created: {
        at: Date.parse(rows[0].timestamp)
      },
      touched: '2026-10-01'
    });
    expect(extractor.extract).toHaveBeenCalledTimes(1);
    expect(rows[0]).not.toHaveProperty('source');
    rows.push({
      id: 'journal-2',
      senderId: 'author',
      timestamp: '2026-11-10T18:00Z',
      content: 'I finished the family story.'
    });
    extractor.extract.mockImplementation(async ({
      messages
    }) => ({
      proposals: [{
        id: 'proposal-2',
        op: 'close_loop',
        target: 'loop.family-story',
        evidenceRef: messages[0].ref,
        quote: messages[0].content,
        fields: {
          status: 'answered'
        }
      }],
      modelVersion: 'fixture'
    }));
    const second = await runtime.prepare({
      username: 'sample',
      jobId: 'job-2',
      from: manifest.from,
      asOf
    });
    const preview = await runtime.resume({
      manifest: second.manifest,
      usageDir
    });
    // An actual edit between extraction and apply must survive the transaction.
    const originalFile = path.join(rootForUser('sample'), 'loops', files[0]);
    const edited = {
      ...object,
      title: 'My chosen story title',
      ask_policy: 'never'
    };
    fs.writeFileSync(originalFile, yaml.dump(edited));
    const secondReceipt = runtime.captureOperatorReceipt({
      manifest: second.manifest
    });
    expect((await runtime.commit({
      manifest: second.manifest,
      artifact: preview.artifact,
      operatorReceipt: secondReceipt
    })).applied).toBe(true);
    const closed = yaml.load(fs.readFileSync(path.join(rootForUser('sample'), 'closed', '2026', files[0]), 'utf8'));
    expect(closed).toMatchObject({
      title: 'My chosen story title',
      ask_policy: 'never',
      status: 'answered',
      closedOn: '2026-11-10',
      loop: {
        answer: {
          at: Date.parse(rows[1].timestamp)
        }
      }
    });
    expect(closed.pinned).toEqual(expect.arrayContaining(['title', 'ask_policy']));
  } finally {
    await runtime.dispose();
    fs.rmSync(tmp, {
      recursive: true,
      force: true
    });
  }
});
