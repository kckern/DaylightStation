import { it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorkRuntime } from '../../../../__app_modules/personal/work/server/runtime.mjs';
import { createKnowledgeImportRuntime } from '../../../../__app_modules/personal/lifelog/server/knowledge-runtime.mjs';
it('prepares and resumes a private 90-day job, rejects crossed artifacts, then imports quiet historical context once', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'work-backfill-flow-'));
  const dataDir = path.join(tmp, 'data'),
    outputDir = path.join(tmp, 'private');
  fs.mkdirSync(dataDir);
  fs.mkdirSync(outputDir);
  const asOf = Date.parse('2026-11-17T18:00Z'),
    rootForUser = username => path.join(dataDir, 'users', username, 'work');
  const rows = [{
    id: 'journal-1',
    senderId: 'author',
    timestamp: '2026-10-01T18:00Z',
    content: 'I will finish the story.'
  }, {
    id: 'ancient',
    senderId: 'author',
    timestamp: '2020-01-01T00:00Z',
    content: 'An old promise.'
  }];
  const journalPath = path.join(dataDir, 'users', 'sample', 'lifelog', 'journalist', 'messages.yml');
  fs.mkdirSync(path.dirname(journalPath), {
    recursive: true
  });
  fs.writeFileSync(journalPath, JSON.stringify({
    messages: rows
  }) + '\n');
  const snapshotFiles = () => Object.fromEntries(fs.readdirSync(dataDir, {
    recursive: true
  }).filter(name => fs.statSync(path.join(dataDir, name)).isFile()).map(name => [name, fs.readFileSync(path.join(dataDir, name)).toString('hex')]));
  const beforeData = snapshotFiles(),
    journalBytes = fs.readFileSync(journalPath, 'utf8');
  const extractor = {
    extract: vi.fn(async ({
      messages
    }) => ({
      proposals: [{
        id: 'story-proposal',
        op: 'open_loop',
        target: 'loop.story',
        evidenceRef: messages[0].ref,
        quote: messages[0].content,
        fields: {
          title: 'Finish the story'
        }
      }],
      modelVersion: 'fixture'
    }))
  };
  const configuration = {
    work: {
      enabled: true,
      write: true,
      importWrites: true,
      writer_env: process.env.DAYLIGHT_ENV || 'docker',
      writer_host: os.hostname(),
      operator_uid: process.getuid(),
      users: {
        sample: {},
        other: {}
      }
    }
  };
  const runtime = createWorkRuntime({
    configuration,
    dataDir,
    rootForUser,
    userTimezone: () => 'America/Los_Angeles',
    clock: () => asOf,
    readCurrent: async () => null,
    readHistory: async () => ({}),
    nextId: () => 'job-1',
    knowledgeBridge: {
      openJob: async ({
        policy,
        checkpoint,
        workContext
      }) => {
        const kb = createKnowledgeImportRuntime({
          configuration: {
            enabled: policy.enabled,
            write: policy.writer.write,
            importWrites: policy.importWrites,
            writer_env: policy.writer.writer_env,
            writer_host: policy.writer.writer_host,
            operator_uid: policy.writer.operatorUid,
            modelCallsPerLocalDay: policy.limits.modelCallsPerLocalDay
          },
          dataDir,
          rootForUser: username => path.join(dataDir, 'users', username, 'lifelog', 'knowledge'),
          checkpoint,
          clock: () => asOf,
          userTimezone: () => 'America/Los_Angeles',
          workContext,
          extractor,
          loadJournal: async username => username === 'sample' ? JSON.parse(fs.readFileSync(journalPath, 'utf8')) : {
            messages: []
          },
          identityForUser: async () => ({
            senderId: 'author',
            conversationId: 'private'
          })
        });
        return {
          bridge: kb.bridge,
          dispose: () => kb.dispose()
        };
      }
    }
  });
  try {
    expect(runtime.backfill).toBeTruthy();
    const prepared = await runtime.backfill.prepare({
      username: 'sample',
      days: 90,
      asOf,
      outputDir
    });
    expect(snapshotFiles()).toEqual(beforeData);
    const preview = await runtime.backfill.preview({
      manifestPath: prepared.manifestPath,
      usageDir: outputDir
    });
    expect(preview.report).toMatchObject({
      complete: true,
      workCoverage: {
        complete: false
      }
    });
    expect(snapshotFiles()).toEqual(beforeData);
    expect(extractor.extract.mock.calls[0][0].messages).toHaveLength(1);
    const repeated = await runtime.backfill.preview({
      manifestPath: prepared.manifestPath,
      usageDir: outputDir
    });
    expect(repeated.artifactPath).toBe(preview.artifactPath);
    expect(extractor.extract).toHaveBeenCalledTimes(1);
    const invalid = JSON.parse(fs.readFileSync(prepared.manifestPath, 'utf8'));
    invalid.username = 'other';
    const crossed = path.join(outputDir, 'crossed.manifest.json');
    fs.writeFileSync(crossed, JSON.stringify(invalid));
    await expect(runtime.backfill.apply({
      manifestPath: crossed,
      artifactPath: preview.artifactPath
    })).rejects.toMatchObject({
      code: 'WORK_BACKFILL_DENIED'
    });
    await expect(runtime.backfill.apply({
      manifestPath: prepared.manifestPath,
      artifactPath: preview.artifactPath,
      operatorReceipt: {
        approved: true
      }
    })).rejects.toMatchObject({
      code: 'KNOWLEDGE_IMPORT_DENIED'
    });
    expect((await runtime.backfill.apply({
      manifestPath: prepared.manifestPath,
      artifactPath: preview.artifactPath
    })).applied).toBe(true);
    expect((await runtime.backfill.apply({
      manifestPath: prepared.manifestPath,
      artifactPath: preview.artifactPath
    })).applied).toBe(false);
    expect(fs.existsSync(path.join(dataDir, 'users', 'other'))).toBe(false);
    expect(fs.readFileSync(journalPath, 'utf8')).toBe(journalBytes);
    expect(extractor.extract).toHaveBeenCalledTimes(1);
  } finally {
    await runtime.dispose();
    fs.rmSync(tmp, {
      recursive: true,
      force: true
    });
  }
});
