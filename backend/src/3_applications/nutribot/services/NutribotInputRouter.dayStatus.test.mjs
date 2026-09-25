/**
 * /done and /fast close a day so coaching trusts its totals even under the
 * logging-completeness threshold. The date is the user's LOCAL date — the
 * original /done used UTC, so an evening /done in Pacific time closed tomorrow.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NutribotInputRouter } from './NutribotInputRouter.mjs';

const silent = { debug() {}, info: vi.fn(), warn() {}, error() {} };

function harness() {
  const healthStore = { markDayStatus: vi.fn(async () => {}), clearDayStatus: vi.fn(async () => {}), setMealFast: vi.fn(async () => {}) };
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

  it('/done takes an explicit date so an older unlogged day can be closed', async () => {
    const { router, rc, healthStore } = harness();
    await router.handleCommand(cmd('done', '2026-09-20'), rc);
    expect(healthStore.markDayStatus).toHaveBeenCalledWith('kckern', '2026-09-20', 'done');
  });

  describe('meal fasts: /fast [meal] [date], /reopen [meal] [date]', () => {
    it('/fast breakfast marks today\'s breakfast fasted without closing the day', async () => {
      const { router, rc, healthStore } = harness();
      await router.handleCommand(cmd('fast', 'breakfast'), rc);
      expect(healthStore.setMealFast).toHaveBeenCalledWith('kckern', '2026-09-23', 'morning', true);
      expect(healthStore.markDayStatus).not.toHaveBeenCalled();
      expect(rc.sendMessage.mock.calls[0][0]).toContain('Breakfast on 2026-09-23');
    });

    it('takes meal and date in either order', async () => {
      const { router, rc, healthStore } = harness();
      await router.handleCommand(cmd('fast', 'lunch yesterday'), rc);
      await router.handleCommand(cmd('fast', 'yesterday Dinner'), rc);
      expect(healthStore.setMealFast).toHaveBeenNthCalledWith(1, 'kckern', '2026-09-22', 'afternoon', true);
      expect(healthStore.setMealFast).toHaveBeenNthCalledWith(2, 'kckern', '2026-09-22', 'evening', true);
    });

    it('/reopen snacks undoes a meal fast, leaving the day alone', async () => {
      const { router, rc, healthStore } = harness();
      await router.handleCommand(cmd('reopen', 'snacks'), rc);
      expect(healthStore.setMealFast).toHaveBeenCalledWith('kckern', '2026-09-23', 'night', false);
      expect(healthStore.clearDayStatus).not.toHaveBeenCalled();
    });

    it('/fast with no meal still fasts the whole day', async () => {
      const { router, rc, healthStore } = harness();
      await router.handleCommand(cmd('fast'), rc);
      expect(healthStore.markDayStatus).toHaveBeenCalledWith('kckern', '2026-09-23', 'fasting');
      expect(healthStore.setMealFast).not.toHaveBeenCalled();
    });

    it('refuses an unknown word, or a meal on /done, with the grammar', async () => {
      const { router, rc, healthStore } = harness();
      await router.handleCommand(cmd('fast', 'brunch'), rc);
      await router.handleCommand(cmd('done', 'breakfast'), rc);
      expect(healthStore.setMealFast).not.toHaveBeenCalled();
      expect(healthStore.markDayStatus).not.toHaveBeenCalled();
      expect(rc.sendMessage.mock.calls[0][0]).toContain('/fast breakfast');
      expect(rc.sendMessage.mock.calls[1][0]).toContain('/done YYYY-MM-DD');
    });
  });

  it('refuses a future or malformed date without writing', async () => {
    const { router, rc, healthStore } = harness();
    await router.handleCommand(cmd('done', '2026-09-30'), rc);
    await router.handleCommand(cmd('fast', 'last tuesday'), rc);
    expect(healthStore.markDayStatus).not.toHaveBeenCalled();
    expect(rc.sendMessage.mock.calls[0][0]).toContain('/done YYYY-MM-DD');
  });

  it('/reopen clears a closure', async () => {
    const { router, rc, healthStore } = harness();
    await router.handleCommand(cmd('reopen', 'yesterday'), rc);
    expect(healthStore.clearDayStatus).toHaveBeenCalledWith('kckern', '2026-09-22');
  });
});
