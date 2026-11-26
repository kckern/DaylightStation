/**
 * The share router: anything shared from the phone, through one intake, to
 * the handler of the app that owns that kind of thing (a video: Media).
 *
 * Reference: __docs/reference/core/share.md
 */
import { YamlQuickInputLedgerStore } from '../../../../../__capabilities/quick-input/server/adapters/index.mjs';
import { quickInputLimits } from '../../../../../__capabilities/quick-input/server/public.mjs';
import { ShareRouter } from '../application/ShareRouter.mjs';
import { createShareQuickInputs, SHARE_BOT } from '../application/shareQuickInputs.mjs';
import { createShareRouter } from '../api/share.mjs';
import { sharePolicy, shareIntakePaths } from '../domain/sharePolicy.mjs';

/** The exact intake paths app.mjs keeps its CORS and body parsers off. */
export function shareSelfGuardedPaths(configService, householdId = null) {
  return shareIntakePaths(sharePolicy(configService.getHouseholdAppConfig(householdId, 'share')));
}

export function createShare({ configService, householdId = null, dataService, handlers, rootLogger }) {
  const logger = rootLogger.child({ module: 'share' });
  const raw = configService.getHouseholdAppConfig(householdId, 'share') || {};
  const policy = sharePolicy(raw);
  const router = new ShareRouter({ handlers, logger });
  const endpoints = createShareQuickInputs({
    router,
    policy,
    ledgerStore: new YamlQuickInputLedgerStore({ dataService, bot: SHARE_BOT, logger }),
    limits: quickInputLimits(raw.quick_input),
    timezone: (username) => configService.getHouseholdTimezone?.(configService.getUserHouseholdId?.(username)),
    deviceConfig: (deviceKey) => configService.getDeviceConfig?.(deviceKey),
    logger,
  });
  logger.info('share.ready', { defaultTarget: policy.defaultTarget, targets: policy.targets.map((t) => t.id), handlers: handlers.map((h) => h.kind) });
  return { router: createShareRouter({ endpoints, policy, router, logger }), policy };
}
