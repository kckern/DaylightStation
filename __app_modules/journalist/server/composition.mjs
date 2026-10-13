import { YamlJournalEntryRepository } from "./adapters/persistence/YamlJournalEntryRepository.mjs";
import { YamlMessageQueueRepository } from "./adapters/persistence/YamlMessageQueueRepository.mjs";
import { JournalistConfigProjection, DebriefRepository, LoggingAIGateway, DataServiceJournalistInteractionLogStore } from "./adapters/index.mjs";
import { JournalistContainer } from "./application/JournalistContainer.mjs";

export function createJournalistServices(config, { createLifelogAggregator }) {
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
  const lifelogAggregator = createLifelogAggregator({ dataService, logger });

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
  const journalistConfig = new JournalistConfigProjection({ configService }).read();

  // Debrief repository (YAML persistence)
  const debriefRepository = new DebriefRepository({
    dataDir: journalistConfig.dataDir,
    username: journalistConfig.username,
    logger
  });

  // Create journalist container with all dependencies
  const journalistContainer = new JournalistContainer(journalistConfig, {
    messagingGateway: telegramAdapter,
    aiGateway,
    journalEntryRepository,
    messageQueueRepository,
    conversationStateStore,
    quizRepository,
    userResolver,
    lifelogAggregator,
    debriefRepository,
    loggingAIGatewayFactory: (deps) => new LoggingAIGateway({
      ...deps,
      interactionLogStore: new DataServiceJournalistInteractionLogStore({ dataService }),
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
