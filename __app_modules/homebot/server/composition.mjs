import { ConfigHouseholdAdapter } from "./adapters/index.mjs";
import { HomeBotContainer } from "./application/HomeBotContainer.mjs";
import { scopedGateway } from "#apps/common/ports/IAIGateway.mjs";

export function createHomebotServices(config) {
  const {
    telegramAdapter,
    aiGateway,
    addSelections,
    configService,
    conversationStateStore,
    websocketBroadcast,
    logger = console
  } = config;

  // Household repository adapter
  const householdRepository = new ConfigHouseholdAdapter({
    configService,
    logger
  });

  // Create homebot container with all dependencies
  const homebotContainer = new HomeBotContainer({
    messagingGateway: telegramAdapter,
    // Gratitude extraction is homebot's only AI consumer.
    aiGateway: scopedGateway(aiGateway, { feature: 'gratitude' }),
    addSelections,
    conversationStateStore,
    householdRepository,
    websocketBroadcast,
    logger
  });

  return {
    homebotContainer,
    householdRepository
  };
}
