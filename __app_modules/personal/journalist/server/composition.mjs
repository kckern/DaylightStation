import { WorkCompanionAdapter } from './adapters/WorkCompanionAdapter.mjs';
import path from 'node:path';
import { KnowledgeFollowUpAdapter } from './adapters/KnowledgeFollowUpAdapter.mjs';
import { YamlJournalEntryRepository } from "./adapters/persistence/YamlJournalEntryRepository.mjs";
import { YamlMessageQueueRepository } from "./adapters/persistence/YamlMessageQueueRepository.mjs";
import { JournalistConfigProjection, DebriefRepository, LoggingAIGateway, DataServiceJournalistInteractionLogStore } from "./adapters/index.mjs";
import { JournalistContainer } from "./application/JournalistContainer.mjs";
export function createJournalistServices(config, {
  createLifelogAggregator
}) {
  const {
    dataService,
    configService,
    telegramAdapter,
    aiGateway,
    userResolver,
    conversationStateStore,
    quizRepository,
    pause,
    logger = console
  } = config;
  const lifelogAggregator = createLifelogAggregator({
    dataService,
    logger,
    workActivityReader: config.workRuntime?.activities,
    userTimezone: config.userTimezone
  });

  // Journal entry repository (YAML persistence)
  const journalEntryRepository = new YamlJournalEntryRepository({
    dataService,
    userResolver,
    configService,
    logger
  });

  // Message queue repository (YAML persistence)
  const messageQueueRepository = new YamlMessageQueueRepository({
    dataService,
    userResolver,
    logger
  });

  // Get journalist config from config service
  const journalistConfig = new JournalistConfigProjection({
    configService
  }).read();

  // Debrief repository (YAML persistence)
  const debriefRepository = new DebriefRepository({
    dataDir: journalistConfig.dataDir,
    userPathFor: configService.getUserDir ? username => path.join(configService.getUserDir(username), 'lifelog', 'journalist') : undefined,
    username: journalistConfig.username,
    logger
  });
  const knowledge = config.knowledgeRuntime?.companion ? new KnowledgeFollowUpAdapter({
    runtime: config.knowledgeRuntime,
    conversationStateStore,
    send: config.knowledgeSend,
    clock: config.clock ?? Date.now
  }) : null;
  const work = config.workRuntime?.conversation ? new WorkCompanionAdapter({
    runtime: config.workRuntime,
    knowledgeCompanion: knowledge,
    send: config.workSend ?? config.knowledgeSend,
    clock: config.clock ?? Date.now
  }) : null;

  // Create journalist container with all dependencies
  const journalistContainer = new JournalistContainer(journalistConfig, {
    knowledgeCompanion: knowledge,
    workCompanion: work,
    followUpSource: knowledge,
    clock: config.clock,
    userTimezone: config.userTimezone,
    messagingGateway: telegramAdapter,
    aiGateway,
    journalEntryRepository,
    messageQueueRepository,
    conversationStateStore,
    quizRepository,
    userResolver,
    lifelogAggregator,
    debriefRepository,
    loggingAIGatewayFactory: deps => new LoggingAIGateway({
      ...deps,
      interactionLogStore: new DataServiceJournalistInteractionLogStore({
        dataService
      })
    }),
    pause,
    logger
  });
  return {
    journalEntryRepository,
    messageQueueRepository,
    journalistContainer
  };
}
