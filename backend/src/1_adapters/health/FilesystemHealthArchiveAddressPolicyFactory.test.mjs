import { describe, expect, it } from 'vitest';
import { FilesystemHealthArchiveAddressPolicyFactory } from './FilesystemHealthArchiveAddressPolicyFactory.mjs';

const factory = new FilesystemHealthArchiveAddressPolicyFactory();
const allowPrivacy = () => false;

describe('FilesystemHealthArchiveAddressPolicyFactory', () => {
  it('normalizes configured roots without changing archive locations', () => {
    const policy = factory.create({
      dataRoot: '/srv/./daylight/data',
      mediaRoot: '/srv/daylight/staging/../media',
    });
    expect(policy.dataRoot).toBe('/srv/daylight/data');
    expect(policy.mediaRoot).toBe('/srv/daylight/media');
  });

  it('recognizes the per-user and shared archive layouts', () => {
    const policy = factory.create({
      dataRoot: '/srv/daylight/data',
      mediaRoot: '/srv/daylight/media',
    });
    const request = {
      userId: 'alice',
      workoutSources: ['strava'],
      isPrivacyExcluded: allowPrivacy,
    };
    expect(policy.isReadableLocation({
      ...request,
      location: '/srv/daylight/data/users/alice/lifelog/archives/notes/training.md',
    })).toBe(true);
    expect(policy.isReadableLocation({
      ...request,
      location: '/srv/daylight/media/archives/strava/old-run.json',
    })).toBe(true);
    expect(policy.isReadableLocation({
      ...request,
      location: '/srv/daylight/data/users/bob/lifelog/archives/notes/private.md',
    })).toBe(false);
  });

  it('preserves the scope root-validation errors', () => {
    expect(() => factory.create({ dataRoot: 'data', mediaRoot: '/media' }))
      .toThrow(/HealthArchiveScope: dataRoot must be an absolute path string/);
    expect(() => factory.create({ dataRoot: '/data', mediaRoot: 'media' }))
      .toThrow(/HealthArchiveScope: mediaRoot must be an absolute path string/);
  });
});
