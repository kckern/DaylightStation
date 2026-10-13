import { TelegramNutribotIdentity } from '../adapters/TelegramNutribotIdentity.mjs';

/** Construct one destination projection at the caller's original initialization point. */
export function createNutribotDestinationResolver({ configService, userIdentityService, optional = false }) {
  if (optional && !userIdentityService?.resolvePlatformId) return () => null;
  const identity = new TelegramNutribotIdentity({ configService, userIdentityService });
  return userId => identity.conversationIdFor(userId);
}
