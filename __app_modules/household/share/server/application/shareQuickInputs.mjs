/**
 * Share quick inputs — the phone sends a share as a quick input of kind text
 * (the shared text itself), through the same queue, receipts and allowance as
 * a typed note. One intake per target screen, over one ledger, so a share
 * counts once however it is retried.
 *
 *   POST /api/v1/share/text              -> the default target
 *   POST /api/v1/share/to/<target>/text  -> that target
 *
 * Device binding: `quick_input: { share: [<username>] }` on the phone's entry
 * in the household devices file.
 *
 * Reference: __docs/reference/core/share.md
 */
import {
  QuickInputIntake, QuickInputLedger, QuickInputEndpoint, boundUsers,
} from '../../../../../__capabilities/quick-input/server/public.mjs';

export const SHARE_BOT = 'share';

/** The intake's kind handler for one target: route the text, answer with what was started. */
export function shareTextHandler({ router, target }) {
  return {
    process: async (input) => {
      const text = input.body.toString('utf8');
      const result = router.route({ text, target, username: input.username });
      if (!result.routed) return { nothing: 'unusable_input' };
      return { state: {}, summary: { share: result.summary } };
    },
  };
}

/**
 * @param {Object} deps
 * @param {ShareRouter} deps.router
 * @param {{ defaultTarget: string, targets: Array<{ id: string }> }} deps.policy
 * @param {Object|null} deps.ledgerStore
 * @param {(deviceKey: string) => Object|null|undefined} deps.deviceConfig
 * @returns {{ default: QuickInputEndpoint, byTarget: Map<string, QuickInputEndpoint> }}
 */
export function createShareQuickInputs({
  router, policy, ledgerStore, limits = {}, timezone, deviceConfig, clock = Date.now, logger = {},
}) {
  const ledger = ledgerStore ? new QuickInputLedger({ store: ledgerStore, limits, timezone, clock }) : null;
  const deviceUsers = (deviceKey) => boundUsers(deviceConfig?.(deviceKey), SHARE_BOT, 'text');
  const endpointFor = (target) => new QuickInputEndpoint({
    intake: ledger
      ? new QuickInputIntake({ bot: SHARE_BOT, kind: 'text', ledger, clock, logger, handler: shareTextHandler({ router, target }) })
      : null,
    deviceUsers,
    // A share has no chat to reply in: the user is its own conversation.
    resolveConversationId: (username) => username,
    logger,
  });
  const byTarget = new Map(policy.targets.map((t) => [t.id, endpointFor(t.id)]));
  return { default: byTarget.get(policy.defaultTarget), byTarget };
}
