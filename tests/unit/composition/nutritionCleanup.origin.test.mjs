// @vitest-environment node
import { it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNutritionCleanup } from '#composition/modules/nutritionCleanup.mjs';
import { NutritionCleanup } from '#apps/nutrition/NutritionCleanup.mjs';
import { ArtworkRemediation } from '#apps/nutrition/ArtworkRemediation.mjs';
import { CleanupQuestionSurface } from '#apps/nutrition/CleanupQuestionSurface.mjs';
import { currentOrigin } from '#system/runtime/aiContext.mjs';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it('stamps the cleanup tick and both artwork timers with their own origins', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cleanup-origin-'));
  const seen = [];
  vi.spyOn(NutritionCleanup.prototype, 'tick').mockImplementation(async () => { await Promise.resolve(); seen.push(['cleanup', currentOrigin()]); });
  vi.spyOn(CleanupQuestionSurface.prototype, 'sync').mockResolvedValue(undefined);
  vi.spyOn(ArtworkRemediation.prototype, 'sweep').mockImplementation(async (_user, { sinceDays }) => { seen.push([`sweep-${sinceDays}`, currentOrigin()]); });
  vi.spyOn(ArtworkRemediation.prototype, 'tick').mockResolvedValue(undefined);
  vi.useFakeTimers();
  try {
    const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
    const cleanup = createNutritionCleanup({
      dataService: { user: { resolveDir: (relative, userId) => join(root, userId, relative) }, household: { read: () => null } },
      configService: { getMediaDir: () => root, getDataDir: () => root, getHeadOfHousehold: () => 'alice' },
      nutribotServices: {
        nutribotContainer: { getFoodLogReview: () => ({ recover: async () => {}, runExclusive: async (_user, action) => action() }), getMessagingGateway: () => ({ available: false }) },
        nutriListStore: { findByDateRange: async () => [] }, foodLogStore: {},
      },
      agentOrchestrator: { register: vi.fn() }, logger, scheduled: true,
    });
    // startup runs the cleanup tick and the weekly artwork sweep at once
    await vi.advanceTimersByTimeAsync(0);
    // the 2-minute artwork tick
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    cleanup.stop();

    expect(seen).toContainEqual(['cleanup', 'tick:nutrition-cleanup']);
    expect(seen).toContainEqual(['sweep-7', 'tick:artwork-sweep']);
    expect(seen).toContainEqual(['sweep-1', 'tick:artwork']);
    expect(currentOrigin()).toBeNull();
  } finally { await rm(root, { recursive: true, force: true }); }
});
