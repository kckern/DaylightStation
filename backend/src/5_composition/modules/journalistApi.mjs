// backend/src/5_composition/modules/journalistApi.mjs
// Composition wiring for Journalist API router(s). Extracted from bootstrap.mjs (Task P2.7-E).

import { JournalistInputRouter } from '#apps/journalist/services/JournalistInputRouter.mjs';
import { TelegramWebhookParser } from '#adapters/telegram/TelegramWebhookParser.mjs';
import { createBotWebhookHandler } from '#adapters/telegram/createBotWebhookHandler.mjs';
import { createJournalistRouter } from '#api/v1/routers/journalist.mjs';
import { createJournalistServices } from '../bootstrap.mjs';
import { JournalistApiService } from '#apps/journalist/JournalistApiService.mjs';
import { DefaultPrincipalResolver } from '#apps/common/context/DefaultPrincipalResolver.mjs';
import { InMemoryRequestDeduplicationStore } from '#adapters/http/InMemoryRequestDeduplicationStore.mjs';

/**
 * Create journalist API router
 * @param {Object} config
 * @param {Object} config.journalistServices - Services from createJournalistServices
 * @param {Object} config.configService - ConfigService for user lookup
 * @param {Object} [config.userResolver] - UserResolver for platform ID mapping
 * @param {Object} [config.secretToken] - Telegram webhook secret token
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createJournalistApiRouter(config) {
  const {
    journalistServices,
    configService,
    userResolver,
    userIdentityService,
    telegramIdentityAdapter,
    botId,
    secretToken,
    gateway,
    aiGatewayAvailable = true,
    logger = console,
    idempotencyStore = new InMemoryRequestDeduplicationStore({ logger })
  } = config;

  // Create webhook parser and input router
  const webhookParser = botId ? new TelegramWebhookParser({ botId, logger }) : null;
  const inputRouter = new JournalistInputRouter(journalistServices.journalistContainer, { userResolver, userIdentityService, logger });

  // Build webhook handler (adapter layer concern, not API layer)
  const webhookHandler = (webhookParser && inputRouter)
    ? createBotWebhookHandler({
        botName: 'journalist',
        botId,
        parser: webhookParser,
        inputRouter,
        gateway,
        logger,
      })
    : null;

  const unavailableAiOperation = {
    execute() {
      const error = new Error('Journalist AI operation is unavailable');
      error.status = 503;
      throw error;
    },
  };
  const journalistApi = new JournalistApiService({
    exportJournal: journalistServices.journalistContainer.getExportJournalMarkdown?.() || null,
    initiatePrompt: aiGatewayAvailable
      ? journalistServices.journalistContainer.getInitiateJournalPrompt()
      : unavailableAiOperation,
    generateMorningDebrief: aiGatewayAvailable
      ? journalistServices.journalistContainer.getGenerateMorningDebrief()
      : unavailableAiOperation,
    sendMorningDebrief: aiGatewayAvailable
      ? journalistServices.journalistContainer.getSendMorningDebrief()
      : unavailableAiOperation,
    principalResolver: new DefaultPrincipalResolver({
      headOfHousehold: () => configService?.getHeadOfHousehold?.(),
      fallback: 'user_1',
    }),
    resolveConversationId: (username) => telegramIdentityAdapter.resolve('journalist', { username }).conversationIdString,
    logger,
  });
  return createJournalistRouter(journalistApi, {
    webhookHandler,
    botId,
    secretToken,
    gateway,
    idempotencyStore,
    logger
  });
}
