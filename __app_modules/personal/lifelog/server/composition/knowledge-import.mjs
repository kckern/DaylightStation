import os from 'node:os';
import { KnowledgeBackfill } from '../application/knowledge/KnowledgeBackfill.mjs';
import { KnowledgeWorkBridge } from '../application/knowledge/KnowledgeWorkBridge.mjs';
import { KnowledgeImportAuthority } from '../adapters/knowledge/KnowledgeImportAuthority.mjs';
import { HistoricalJournalEvidence } from '../adapters/knowledge/HistoricalJournalEvidence.mjs';
import { KnowledgeWriteAuthority } from '../adapters/knowledge/KnowledgeWriteAuthority.mjs';
import { JsonlKnowledgeLedger } from '../adapters/knowledge/JsonlKnowledgeLedger.mjs';
import { YamlKnowledgeStore } from '../adapters/knowledge/YamlKnowledgeStore.mjs';
import { GatewayKnowledgeExtractor } from '../adapters/knowledge/GatewayKnowledgeExtractor.mjs';
import { outsideKnowledgeDirectory, reserveKnowledgeAttempt } from '../adapters/knowledge/KnowledgeAttemptBudget.mjs';
import { assertUsername } from '../adapters/knowledge/knowledgeFiles.mjs';
import { importDigest } from '../domain/knowledge/importManifest.mjs';

/** An explicit job owns its writer; it never enables or starts live KB maintenance. */
export function createKnowledgeImportRuntime(options) {
  const {
    configuration = {},
    clock = Date.now,
    dataDir,
    checkpoint,
    loadJournal,
    identityForUser,
    userTimezone,
    logger
  } = options;
  if (configuration.enabled !== true) return {
    prepare: null,
    resume: null,
    commit: null,
    bridge: null,
    dispose: async () => {}
  };
  const authority = new KnowledgeImportAuthority({
    configuration,
    clock
  });
  const writer = new KnowledgeWriteAuthority({
    configuration: {
      ...configuration,
      enabled: authority.canImport,
      write: authority.canImport
    },
    environment: process.env.DAYLIGHT_ENV || 'docker',
    hostId: os.hostname(),
    logger
  });
  const rootForUser = username => {
    assertUsername(username);
    return options.rootForUser(username);
  };
  const ledger = new JsonlKnowledgeLedger({
    rootForUser,
    hostId: os.hostname(),
    authority: writer,
    logger
  });
  const store = new YamlKnowledgeStore({
    rootForUser,
    ledger,
    authority: writer,
    clock,
    logger
  });
  const historical = new HistoricalJournalEvidence({
    loadJournal,
    identityForUser,
    timezoneForUser: userTimezone,
    logger
  });
  let extractorPromise;
  const extractor = options.extractor ?? {
    extract: async input => {
      extractorPromise ??= (async () => {
        const gateway = options.gateway ?? (await options.gatewayFactory?.());
        return new GatewayKnowledgeExtractor({
          gateway,
          model: configuration.model,
          modelVersion: configuration.model ?? gateway?.model ?? 'configured-gateway'
        });
      })();
      return (await extractorPromise).extract(input);
    }
  };
  const service = new KnowledgeBackfill({
    knowledgeStore: store,
    journalEvidence: historical,
    checkpoints: checkpoint,
    extractor,
    verifyImport: input => authority.verify(input),
    workContext: options.workContext,
    clock,
    userTimezone,
    usageBudget: ({
      usageDir,
      ...input
    }) => reserveKnowledgeAttempt({
      ...input,
      dir: outsideKnowledgeDirectory(usageDir, dataDir),
      maxAttempts: configuration.modelCallsPerLocalDay ?? 4
    })
  });
  const runtime = {
    prepare: input => service.prepare(input),
    resume: input => service.resume(input),
    captureOperatorReceipt: input => authority.captureOperatorReceipt(input),
    commit: ({
      manifest,
      artifact,
      operatorReceipt,
      capability
    }) => service.commit({
      manifest,
      artifact,
      capability: capability ?? authority.authorize({
        manifest,
        artifactDigest: importDigest(artifact),
        sourceHashes: manifest.sourceHashes,
        operatorReceipt
      })
    }),
    dispose: async () => {
      service.close();
      authority.close();
      await store.close();
    }
  };
  runtime.bridge = new KnowledgeWorkBridge({
    backfill: runtime
  });
  return runtime;
}
