import { createMessagingRouter } from '#api/v1/routers/messaging.mjs';
import { MessagingHttpFacade } from '#api/v1/presenters/MessagingHttpFacade.mjs';
import { nowTs24 } from '#system/utils/index.mjs';

/** Compose the optional messaging API without implicitly mounting it. */
export function createMessagingApiRouter({ messagingServices }) {
  const messagingService = new MessagingHttpFacade({
    conversationService: messagingServices.conversationService,
    notificationService: messagingServices.notificationService,
    telegram: messagingServices.telegramAdapter,
    email: messagingServices.gmailAdapter,
    timestamp: nowTs24,
    nowMs: Date.now,
  });
  return createMessagingRouter({ messagingService });
}
