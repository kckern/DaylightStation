/**
 * HealthArchiveScopeFactory (F4-A) unit tests.
 *
 * The factory builds per-user HealthArchiveScope instances from a user's
 * playbook (`archive.workout_sources`). It caches per-userId for a configurable
 * TTL so playbook edits eventually take effect without process restart.
 */

import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { HealthArchiveScopeFactory } from '#domains/health/services/HealthArchiveScopeFactory.mjs';

const PROJECT_ROOT = '/srv/daylight';
const DATA_ROOT = path.join(PROJECT_ROOT, 'data');
const MEDIA_ROOT = path.join(PROJECT_ROOT, 'media');

function abs(rel) {
  return path.join(PROJECT_ROOT, rel);
}

function makePersonalContextLoader(playbookByUser) {
  return {
    loadPlaybook: vi.fn(async (userId) => playbookByUser[userId] ?? null),
  };
}

describe('HealthArchiveScopeFactory', () => {
  it('returns a scope for a user with default workout sources when playbook is missing', async () => {
    const loader = makePersonalContextLoader({}); // no playbook for anyone
    const factory = new HealthArchiveScopeFactory({
      dataRoot: DATA_ROOT,
      mediaRoot: MEDIA_ROOT,
      personalContextLoader: loader,
    });

    const scope = await factory.forUser('test-user');
    expect([...scope.workoutSources]).toEqual(['strava', 'garmin']);
    expect(scope.isReadable(
      abs('data/users/test-user/lifelog/archives/strava/run.json'),
      'test-user',
    )).toBe(true);
    expect(scope.isReadable(
      abs('data/users/test-user/lifelog/archives/apple_health/foo.xml'),
      'test-user',
    )).toBe(false);
  });

  it('returns a scope respecting the user playbook archive.workout_sources', async () => {
    const loader = makePersonalContextLoader({
      'test-user': {
        archive: { workout_sources: ['strava', 'garmin', 'apple_health'] },
      },
    });
    const factory = new HealthArchiveScopeFactory({
      dataRoot: DATA_ROOT,
      mediaRoot: MEDIA_ROOT,
      personalContextLoader: loader,
    });

    const scope = await factory.forUser('test-user');
    expect([...scope.workoutSources]).toEqual(['strava', 'garmin', 'apple_health']);
    expect(scope.isReadable(
      abs('data/users/test-user/lifelog/archives/apple_health/foo.xml'),
      'test-user',
    )).toBe(true);
  });

  it('unions defaults with user-declared sources (defaults always present)', async () => {
    // The user only declared apple_health — but defaults must still be allowed.
    const loader = makePersonalContextLoader({
      'test-user': { archive: { workout_sources: ['apple_health'] } },
    });
    const factory = new HealthArchiveScopeFactory({
      dataRoot: DATA_ROOT,
      mediaRoot: MEDIA_ROOT,
      personalContextLoader: loader,
    });

    const scope = await factory.forUser('test-user');
    expect([...scope.workoutSources]).toEqual(['strava', 'garmin', 'apple_health']);
  });

  it('falls back to defaults when archive section is missing from playbook', async () => {
    const loader = makePersonalContextLoader({
      'test-user': { profile: { age_range: '30s' } /* no archive */ },
    });
    const factory = new HealthArchiveScopeFactory({
      dataRoot: DATA_ROOT,
      mediaRoot: MEDIA_ROOT,
      personalContextLoader: loader,
    });

    const scope = await factory.forUser('test-user');
    expect([...scope.workoutSources]).toEqual(['strava', 'garmin']);
  });

  it('falls back to defaults when archive.workout_sources is empty', async () => {
    const loader = makePersonalContextLoader({
      'test-user': { archive: { workout_sources: [] } },
    });
    const factory = new HealthArchiveScopeFactory({
      dataRoot: DATA_ROOT,
      mediaRoot: MEDIA_ROOT,
      personalContextLoader: loader,
    });

    const scope = await factory.forUser('test-user');
    expect([...scope.workoutSources]).toEqual(['strava', 'garmin']);
  });

  it('does NOT throw when no personalContextLoader is wired (graceful degradation)', async () => {
    const factory = new HealthArchiveScopeFactory({
      dataRoot: DATA_ROOT,
      mediaRoot: MEDIA_ROOT,
      // personalContextLoader intentionally absent
    });
    const scope = await factory.forUser('test-user');
    expect([...scope.workoutSources]).toEqual(['strava', 'garmin']);
  });

  it('caches per userId — same user resolves once until TTL expires', async () => {
    const loader = makePersonalContextLoader({
      'test-user': { archive: { workout_sources: ['apple_health'] } },
    });
    const factory = new HealthArchiveScopeFactory({
      dataRoot: DATA_ROOT,
      mediaRoot: MEDIA_ROOT,
      personalContextLoader: loader,
    });

    const a = await factory.forUser('test-user');
    const b = await factory.forUser('test-user');
    expect(a).toBe(b);
    expect(loader.loadPlaybook).toHaveBeenCalledTimes(1);
  });

  it('different users get different scopes', async () => {
    const loader = makePersonalContextLoader({
      'user-a': { archive: { workout_sources: ['apple_health'] } },
      'user-b': { archive: { workout_sources: ['whoop'] } },
    });
    const factory = new HealthArchiveScopeFactory({
      dataRoot: DATA_ROOT,
      mediaRoot: MEDIA_ROOT,
      personalContextLoader: loader,
    });

    const a = await factory.forUser('user-a');
    const b = await factory.forUser('user-b');
    expect(a).not.toBe(b);
    expect([...a.workoutSources]).toEqual(['strava', 'garmin', 'apple_health']);
    expect([...b.workoutSources]).toEqual(['strava', 'garmin', 'whoop']);
  });

  it('respects the configured TTL — re-loads playbook after the window expires', async () => {
    let now = 1000;
    const loader = makePersonalContextLoader({
      'test-user': { archive: { workout_sources: ['apple_health'] } },
    });
    const factory = new HealthArchiveScopeFactory({
      dataRoot: DATA_ROOT,
      mediaRoot: MEDIA_ROOT,
      personalContextLoader: loader,
      cacheTtlMs: 5000,
      now: () => now,
    });

    await factory.forUser('test-user');
    expect(loader.loadPlaybook).toHaveBeenCalledTimes(1);

    // Within TTL — cache hit.
    now += 4999;
    await factory.forUser('test-user');
    expect(loader.loadPlaybook).toHaveBeenCalledTimes(1);

    // Past TTL — cache miss, playbook re-read.
    now += 100;
    await factory.forUser('test-user');
    expect(loader.loadPlaybook).toHaveBeenCalledTimes(2);
  });

  it('invalidate(userId) drops the cached entry', async () => {
    const loader = makePersonalContextLoader({
      'test-user': { archive: { workout_sources: ['apple_health'] } },
    });
    const factory = new HealthArchiveScopeFactory({
      dataRoot: DATA_ROOT,
      mediaRoot: MEDIA_ROOT,
      personalContextLoader: loader,
    });

    await factory.forUser('test-user');
    expect(loader.loadPlaybook).toHaveBeenCalledTimes(1);
    factory.invalidate('test-user');
    await factory.forUser('test-user');
    expect(loader.loadPlaybook).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed userIds via assertValidUserId', async () => {
    const factory = new HealthArchiveScopeFactory({
      dataRoot: DATA_ROOT,
      mediaRoot: MEDIA_ROOT,
    });
    await expect(factory.forUser('../evil')).rejects.toThrow();
    await expect(factory.forUser('')).rejects.toThrow();
    await expect(factory.forUser(null)).rejects.toThrow();
  });

  it('logs cache hits and misses at debug', async () => {
    const debug = vi.fn();
    const factory = new HealthArchiveScopeFactory({
      dataRoot: DATA_ROOT,
      mediaRoot: MEDIA_ROOT,
      logger: { debug, info: vi.fn(), warn: vi.fn() },
    });
    await factory.forUser('test-user');
    await factory.forUser('test-user');
    const events = debug.mock.calls.map((c) => c[0]);
    expect(events).toContain('archive_scope_factory.cache_miss');
    expect(events).toContain('archive_scope_factory.cache_hit');
  });

  describe('additional privacy exclusions (F4-C)', () => {
    it('passes archive.additional_privacy_exclusions through to the scope it builds', async () => {
      const loader = makePersonalContextLoader({
        'test-user': {
          archive: {
            additional_privacy_exclusions: ['therapy-notes', 'client-confidential'],
          },
        },
      });
      const factory = new HealthArchiveScopeFactory({
        dataRoot: DATA_ROOT,
        mediaRoot: MEDIA_ROOT,
        personalContextLoader: loader,
      });

      const scope = await factory.forUser('test-user');
      expect([...scope.additionalPrivacyExclusions]).toEqual([
        'therapy-notes',
        'client-confidential',
      ]);
      // The produced scope rejects matching paths.
      expect(scope.isReadable(
        abs('data/users/test-user/lifelog/archives/notes/therapy-notes/2024.md'),
        'test-user',
      )).toBe(false);
      expect(scope.isReadable(
        abs('data/users/test-user/lifelog/archives/notes/client-confidential/case.md'),
        'test-user',
      )).toBe(false);
    });

    it('without playbook additions, only the floor applies (regression)', async () => {
      const loader = makePersonalContextLoader({
        'test-user': { archive: { workout_sources: ['strava'] } /* no additions */ },
      });
      const factory = new HealthArchiveScopeFactory({
        dataRoot: DATA_ROOT,
        mediaRoot: MEDIA_ROOT,
        personalContextLoader: loader,
      });

      const scope = await factory.forUser('test-user');
      expect([...scope.additionalPrivacyExclusions]).toEqual([]);
      // Floor still rejects email/banking/etc.
      expect(scope.isReadable(
        abs('data/users/test-user/lifelog/archives/notes/email-thread.md'),
        'test-user',
      )).toBe(false);
      // Benign path still passes.
      expect(scope.isReadable(
        abs('data/users/test-user/lifelog/archives/notes/training-log.md'),
        'test-user',
      )).toBe(true);
    });

    it('logs privacy.addition_matched at info when a scope is built with additions', async () => {
      const info = vi.fn();
      const loader = makePersonalContextLoader({
        'test-user': {
          archive: { additional_privacy_exclusions: ['therapy-notes'] },
        },
      });
      const factory = new HealthArchiveScopeFactory({
        dataRoot: DATA_ROOT,
        mediaRoot: MEDIA_ROOT,
        personalContextLoader: loader,
        logger: { debug: vi.fn(), info, warn: vi.fn() },
      });
      await factory.forUser('test-user');
      const events = info.mock.calls.map((c) => c[0]);
      expect(events).toContain('privacy.addition_matched');
    });

    it('does NOT log privacy.addition_matched when there are no additions', async () => {
      const info = vi.fn();
      const loader = makePersonalContextLoader({
        'test-user': { archive: { workout_sources: ['strava'] } },
      });
      const factory = new HealthArchiveScopeFactory({
        dataRoot: DATA_ROOT,
        mediaRoot: MEDIA_ROOT,
        personalContextLoader: loader,
        logger: { debug: vi.fn(), info, warn: vi.fn() },
      });
      await factory.forUser('test-user');
      const events = info.mock.calls.map((c) => c[0]);
      expect(events).not.toContain('privacy.addition_matched');
    });

    it('drops non-string and whitespace-only entries from playbook additions', async () => {
      const loader = makePersonalContextLoader({
        'test-user': {
          archive: {
            additional_privacy_exclusions: [
              '  therapy-notes  ',
              '',
              '   ',
              null,
              42,
              'client-confidential',
            ],
          },
        },
      });
      const factory = new HealthArchiveScopeFactory({
        dataRoot: DATA_ROOT,
        mediaRoot: MEDIA_ROOT,
        personalContextLoader: loader,
      });
      const scope = await factory.forUser('test-user');
      expect([...scope.additionalPrivacyExclusions]).toEqual([
        'therapy-notes',
        'client-confidential',
      ]);
    });
  });

  it('treats playbook load errors as graceful — falls back to defaults', async () => {
    const loader = {
      loadPlaybook: vi.fn(async () => { throw new Error('boom'); }),
    };
    const factory = new HealthArchiveScopeFactory({
      dataRoot: DATA_ROOT,
      mediaRoot: MEDIA_ROOT,
      personalContextLoader: loader,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    });
    const scope = await factory.forUser('test-user');
    expect([...scope.workoutSources]).toEqual(['strava', 'garmin']);
  });
});
