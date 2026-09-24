/**
 * /done and /fast close a day so coaching trusts its totals even under the
 * logging-completeness threshold. The date is the user's LOCAL date — the
 * original /done used UTC, so an evening /done in Pacific time closed tomorrow.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NutribotInputRouter } from './NutribotInputRouter.mjs';

const silent = { debug() {}, info: vi.fn(), warn() {}, error() {} };

function harness() {
  const healthStore = { markDayStatus: vi.fn(async () => {}) };
  const container = {
    getConversationStateStore: () => null,
    getFoodLogStore: () => null,
    getNutriListStore: () => null,
    getMessagingGateway: () => ({ sendMessage: vi.fn(async () => ({})) }),
    getHealthStore: () => healthStore,
    getConfig: () => ({ getUserTimezone: () => 'America/Los_Angeles' }),
  };
  const router = new NutribotInputRouter(container, { logger: silent });
  const rc = { sendMessage: vi.fn(async () => ({ messageId: 'm' })) };
  return { router, rc, healthStore };
}
const cmd = (command, text = '') => ({ conversationId: 'telegram:b1_c2', userId: 'kckern', payload: { command, text } });

describe('NutribotInputRouter /done and /fast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T03:30:00Z')); // 8:30pm PDT on 09-23
  });
  afterEach(() => vi.useRealTimers());

  it('/done closes the local date, not the UTC date', async () => {
    const { router, rc, healthStore } = harness();
    await router.handleCommand(cmd('done'), rc);
    expect(healthStore.markDayStatus).toHaveBeenCalledWith('kckern', '2026-09-23', 'done');
    expect(rc.sendMessage.mock.calls[0][0]).toContain('Marked 2026-09-23 as done');
  });

  it('/fast yesterday marks the previous local day as a fast', async () => {
    const { router, rc, healthStore } = harness();
    await router.handleCommand(cmd('fast', 'yesterday'), rc);
    expect(healthStore.markDayStatus).toHaveBeenCalledWith('kckern', '2026-09-22', 'fasting');
    expect(rc.sendMessage.mock.calls[0][0]).toContain('as a fast');
  });
});
