/**
 * StravaWebhookJobStore — findActionable filter contract
 *
 * Pins down the positive filter behavior so a future refactor can't
 * accidentally regress: only `pending` and `unmatched` jobs are surfaced
 * for re-attempt; `completed` and `abandoned` are terminal and excluded.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('#system/utils/FileIO.mjs', () => ({
  loadYaml: vi.fn(),
  saveYaml: vi.fn(),
  ensureDir: vi.fn(),
  listYamlFiles: vi.fn(),
  dirExists: vi.fn(),
}));

const { StravaWebhookJobStore } = await import('#adapters/strava/StravaWebhookJobStore.mjs');
const { loadYaml, listYamlFiles, dirExists } = await import('#system/utils/FileIO.mjs');

describe('StravaWebhookJobStore.findActionable', () => {
  let store;

  beforeEach(() => {
    vi.resetAllMocks();
    dirExists.mockReturnValue(true);
    store = new StravaWebhookJobStore({
      basePath: '/tmp/fake-jobs',
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    });
  });

  test('includes pending jobs', () => {
    listYamlFiles.mockReturnValue(['111']);
    loadYaml.mockReturnValue({ activityId: 111, status: 'pending', attempts: 0 });
    const jobs = store.findActionable();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].activityId).toBe(111);
  });

  test('includes unmatched jobs (will be retried)', () => {
    listYamlFiles.mockReturnValue(['222']);
    loadYaml.mockReturnValue({ activityId: 222, status: 'unmatched', attempts: 3 });
    const jobs = store.findActionable();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].activityId).toBe(222);
  });

  test('excludes completed jobs (terminal)', () => {
    listYamlFiles.mockReturnValue(['333']);
    loadYaml.mockReturnValue({ activityId: 333, status: 'completed' });
    expect(store.findActionable()).toEqual([]);
  });

  test('excludes abandoned jobs (terminal)', () => {
    listYamlFiles.mockReturnValue(['444']);
    loadYaml.mockReturnValue({ activityId: 444, status: 'abandoned', attempts: 10 });
    expect(store.findActionable()).toEqual([]);
  });
});
