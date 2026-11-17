import { it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { createKnowledgeRuntime, createKnowledgeImportRuntime, createJournalKnowledgeSource } from '../knowledge-runtime.mjs';
import { importDigest } from '../domain/knowledge/importManifest.mjs';
import { AS_OF, TZ, fakeClock } from '../application/knowledge/fixtures.testHelpers.mjs';
it.each([false, true])('resolves CLI-imported unquoted journal bytes in production KB and treats unavailable bytes as unavailable (old conflicts: %s)', async oldConflicts => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-source-boundary-')),
    dataDir = path.join(tmp, 'data'),
    userDir = path.join(dataDir, 'users', 'sample'),
    usageDir = path.join(tmp, 'private');
  fs.mkdirSync(usageDir);
  const file = path.join(userDir, 'lifelog', 'journalist', 'messages.yml');
  fs.mkdirSync(path.dirname(file), {
    recursive: true
  });
  const old = oldConflicts ? "  - {id: old, senderId: '101', timestamp: '2020-01-01 09:00:00', content: old version}\n  - {id: old, senderId: '101', timestamp: '2020-01-01 09:00:00', content: conflicting version}\n" : '';
  fs.writeFileSync(file, "messages:\n" + old + "  - id: entry-1\n    senderId: '101'\n    timestamp: 2026-11-02T18:00:00Z\n    content: I will finish the story.\n");
  const loadJournal = createJournalKnowledgeSource({
      userDirForUser: () => userDir
    }),
    identity = {
      senderId: '101',
      conversationId: 'telegram:b42_c101'
    },
    logger = {
      info() {},
      warn() {},
      debug() {},
      error() {}
    },
    cache = new Map();
  const checkpoint = {
    read: async () => ({
      chunks: {}
    }),
    append: async () => {},
    readChunk: async ({
      chunkId
    }) => cache.get(chunkId),
    writeChunk: async input => {
      const entry = {
        ...input,
        resultDigest: importDigest(input.result)
      };
      cache.set(input.chunkId, entry);
      return entry;
    }
  };
  let imported, live;
  try {
    imported = createKnowledgeImportRuntime({
      configuration: {
        enabled: true,
        write: true,
        importWrites: true,
        writer_env: process.env.DAYLIGHT_ENV || 'docker',
        writer_host: os.hostname(),
        operator_uid: process.getuid()
      },
      rootForUser: () => path.join(userDir, 'lifelog', 'knowledge'),
      dataDir,
      checkpoint,
      loadJournal,
      identityForUser: async () => identity,
      userTimezone: () => TZ,
      clock: () => AS_OF,
      logger,
      extractor: {
        extract: async ({
          messages
        }) => ({
          proposals: [{
            id: 'import-story',
            op: 'open_loop',
            target: 'loop.story',
            evidenceRef: messages[0].ref,
            quote: messages[0].content,
            fields: {
              title: 'Finish the story'
            }
          }],
          modelVersion: 'fixture'
        })
      }
    });
    const {
        manifest
      } = await imported.prepare({
        username: 'sample',
        from: AS_OF - 90 * 86400000,
        asOf: AS_OF,
        jobId: 'job-1'
      }),
      {
        artifact
      } = await imported.resume({
        manifest,
        usageDir
      });
    await imported.commit({
      manifest,
      artifact,
      operatorReceipt: imported.captureOperatorReceipt({
        manifest
      })
    });
    await imported.dispose();
    const configService = {
      getUserDir: () => userDir,
      getHouseholdUsers: () => ['sample'],
      getUserProfile: () => ({
        timezone: TZ
      }),
      getUserHouseholdId: () => 'household',
      getHouseholdTimezone: () => TZ
    };
    const models = vi.fn(async () => ({
      proposals: []
    }));
    live = createKnowledgeRuntime({
      configuration: {
        enabled: true,
        write: true,
        writer_env: process.env.DAYLIGHT_ENV || 'docker',
        writer_host: os.hostname()
      },
      environment: process.env.DAYLIGHT_ENV || 'docker',
      hostId: os.hostname(),
      platform: 'linux',
      configService,
      dataService: {
        user: {
          read: () => {
            try {
              return yaml.load(fs.readFileSync(file, 'utf8'));
            } catch {
              return null;
            }
          }
        }
      },
      userIdentityService: {
        resolvePlatformId: () => identity.senderId,
        resolveUsername: () => 'sample'
      },
      telegramIdentityAdapter: {
        resolve: () => ({
          conversationIdString: identity.conversationId
        })
      },
      gateway: {
        model: 'fixture',
        scoped() {
          return this;
        },
        chatStructured: models
      },
      webhookSecret: 'fixture-secret',
      send: async () => ({
        messageId: '1'
      }),
      scheduler: fakeClock().scheduler,
      clock: () => AS_OF,
      logger
    });
    expect(await live.start()).toMatchObject({
      users: 1
    });
    expect(await live.maintenance.execute({
      username: 'sample',
      trigger: 'nightly',
      asOf: AS_OF
    })).toMatchObject({
      status: 'completed'
    });
    await live.followUps.selectForMorning({
      username: 'sample',
      askDate: '2026-11-03',
      asOf: AS_OF
    });
    const stateFile = path.join(userDir, 'lifelog', 'knowledge', 'state.yml'),
      readState = () => yaml.load(fs.readFileSync(stateFile, 'utf8'));
    const ref = Object.keys(readState().importAuthorizations)[0];
    expect(readState().invalidatedRefs ?? []).not.toContain(ref);
    fs.writeFileSync(file, 'messages: [unreadable YAML');
    await expect(live.followUps.selectForMorning({
      username: 'sample',
      askDate: '2026-11-03',
      asOf: AS_OF
    })).rejects.toThrow();
    expect(readState().invalidatedRefs ?? []).not.toContain(ref);
    expect(models).not.toHaveBeenCalled();
  } finally {
    await imported?.dispose();
    await live?.dispose();
    fs.rmSync(tmp, {
      recursive: true,
      force: true
    });
  }
});
