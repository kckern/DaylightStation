// @vitest-environment node
import { it, expect, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNutritionCleanup } from '#composition/modules/nutritionCleanup.mjs';

it('composes a paused, preview-only cleanup service without Telegram or a backend server', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cleanup-composition-'));
  try {
    const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
    const register = vi.fn();
    const cleanup = createNutritionCleanup({
      dataService: { user: { resolveDir: (relative, userId) => join(root, userId, relative) }, household: { read: () => null } },
      configService: { getMediaDir: () => root, getDataDir: () => root, getHeadOfHousehold: () => 'alice' },
      nutribotServices: {
        nutribotContainer: { getFoodLogReview: () => ({}), getMessagingGateway: () => ({ available: false }) },
        nutriListStore: {}, foodLogStore: {},
      },
      agentOrchestrator: { register }, logger,
    });
    expect(cleanup.status('alice')).toMatchObject({ settings: { enabled: false, dryRun: true }, questions: [], runs: [] });
    expect(register).toHaveBeenCalledOnce();
    const [AgentClass, dependencies] = register.mock.calls[0];
    expect(new AgentClass(dependencies).getSystemPrompt()).toContain('Never delete food');
    await cleanup.tick('alice');
    expect(logger.error).not.toHaveBeenCalled();
    cleanup.stop();
  } finally { await rm(root, { recursive: true, force: true }); }
});
