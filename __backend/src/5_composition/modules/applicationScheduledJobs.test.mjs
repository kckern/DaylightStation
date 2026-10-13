import { describe, expect, it, vi } from 'vitest';
import { createApplicationScheduledJobs } from './applicationScheduledJobs.mjs';

const fixedDate = new Date('2026-08-30T12:00:00.000Z');

function composition(overrides = {}) {
  return createApplicationScheduledJobs({
    financeHarvestService: { harvest: vi.fn().mockResolvedValue({ status: 'success' }) },
    healthService: { execute: vi.fn().mockResolvedValue({}) },
    archiveService: { rotateToArchive: vi.fn().mockReturnValue({ rotated: 2, kept: 3, yearsUpdated: [2025] }) },
    loadArchiveConfig: () => ({ services: {} }),
    foodLogStore: { archiveOldLogs: vi.fn().mockResolvedValue({ archived: 0, kept: 1, months: [] }) },
    nutriListStore: { archiveOldItems: vi.fn().mockResolvedValue({ archived: 0, kept: 1, months: [] }) },
    mediaMemoryValidator: { validateMediaMemory: vi.fn().mockResolvedValue({ checked: 1, valid: 1 }) },
    resolveHouseholdId: () => 'home',
    resolveUsername: () => 'parent',
    clock: { now: () => fixedDate, epoch: () => fixedDate.getTime() },
    logger: { info: vi.fn() },
    ...overrides,
  });
}

describe('application scheduled-job composition', () => {
  it('registers every production job formerly backed by a deleted module', () => {
    const executor = composition();
    expect(['budget', 'health', 'archive-rotation', 'media-memory-validator']
      .every((id) => executor.canHandle(id))).toBe(true);
  });

  it('dispatches budget and health through current application services', async () => {
    const financeHarvestService = { harvest: vi.fn().mockResolvedValue({ status: 'success' }) };
    const healthService = { execute: vi.fn().mockResolvedValue({}) };
    const executor = composition({ financeHarvestService, healthService });

    await executor.execute('budget', { skipCategorization: true });
    await executor.execute('health', { daysBack: 30 });

    expect(financeHarvestService.harvest).toHaveBeenCalledWith('home', { skipCategorization: true });
    expect(healthService.execute).toHaveBeenCalledWith('parent', 30, fixedDate);
  });

  it('uses generic lifelog rotation only for the schema it supports', async () => {
    const archiveService = { rotateToArchive: vi.fn().mockReturnValue({ rotated: 1, kept: 2, yearsUpdated: [2025] }) };
    const foodLogStore = { archiveOldLogs: vi.fn().mockResolvedValue({ archived: 3, kept: 4, months: ['2025-01'] }) };
    const nutriListStore = { archiveOldItems: vi.fn().mockResolvedValue({ archived: 5, kept: 6, months: ['2025-02'] }) };
    const executor = composition({
      archiveService,
      foodLogStore,
      nutriListStore,
      loadArchiveConfig: () => ({ services: {
        lastfm: { enabled: true, pattern: 'time-based' },
        strava: { enabled: true, pattern: 'summary-detail' },
        nutrilog: { enabled: true, pattern: 'time-based', basePath: 'nutrition' },
        nutrilist: { enabled: true, pattern: 'time-based', basePath: 'nutrition' },
      } }),
    });

    const result = await executor.execute('archive-rotation');

    expect(archiveService.rotateToArchive).toHaveBeenCalledTimes(1);
    expect(archiveService.rotateToArchive).toHaveBeenCalledWith('parent', 'lastfm');
    expect(foodLogStore.archiveOldLogs).toHaveBeenCalledWith('parent');
    expect(nutriListStore.archiveOldItems).toHaveBeenCalledWith('parent');
    expect(result.results.map(({ service }) => service)).toEqual(['lastfm', 'nutrilog', 'nutrilist']);
  });

  it('passes an explicit clock and dry-run option to media validation', async () => {
    const mediaMemoryValidator = { validateMediaMemory: vi.fn().mockResolvedValue({ checked: 0 }) };
    const executor = composition({ mediaMemoryValidator });

    await executor.execute('media-memory-validator', { dryRun: true });

    expect(mediaMemoryValidator.validateMediaMemory).toHaveBeenCalledWith({
      dryRun: true,
      nowMs: fixedDate.getTime(),
    });
  });
});
