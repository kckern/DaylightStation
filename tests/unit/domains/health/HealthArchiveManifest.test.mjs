import { describe, it, expect } from 'vitest';
import {
  HealthArchiveManifest,
  BUILT_IN_CATEGORIES,
  VALID_CATEGORIES,
} from '../../../../backend/src/2_domains/health/entities/HealthArchiveManifest.mjs';

describe('HealthArchiveManifest', () => {
  it('constructs with valid fields', () => {
    const m = new HealthArchiveManifest({
      userId: 'test-user',
      category: 'scans',
      lastSync: '2026-05-01T10:00:00Z',
      sourceLocations: [{ path: '/external/scans', fileCount: 4, lastModified: '2026-04-29T08:00:00Z' }],
      schemaVersions: { primary: 'v1' },
      recordCounts: { totalFiles: 4, dateRange: { earliest: '2018-01-01', latest: '2026-04-01' } },
    });
    expect(m.userId).toBe('test-user');
    expect(m.category).toBe('scans');
    expect(m.recordCounts.totalFiles).toBe(4);
  });

  it('accepts every built-in category by default', () => {
    for (const cat of BUILT_IN_CATEGORIES) {
      expect(() => new HealthArchiveManifest({ userId: 'test-user', category: cat }))
        .not.toThrow();
    }
  });

  it('rejects unknown category by default', () => {
    expect(() => new HealthArchiveManifest({ userId: 'test-user', category: 'email' }))
      .toThrow(/category/);
  });

  it('accepts an extra category when validCategories includes it', () => {
    expect(() => new HealthArchiveManifest({
      userId: 'test-user',
      category: 'hr-recovery',
      validCategories: [...BUILT_IN_CATEGORIES, 'hr-recovery'],
    })).not.toThrow();
  });

  it('still rejects categories outside both the floor and the override', () => {
    expect(() => new HealthArchiveManifest({
      userId: 'test-user',
      category: 'mood-journal',
      validCategories: [...BUILT_IN_CATEGORIES, 'hr-recovery'],
    })).toThrow(/category/);
  });

  it('VALID_CATEGORIES export still contains the same six items as the floor', () => {
    expect(VALID_CATEGORIES).toBeInstanceOf(Set);
    expect([...VALID_CATEGORIES].sort()).toEqual([...BUILT_IN_CATEGORIES].sort());
    expect(BUILT_IN_CATEGORIES.length).toBe(6);
  });

  it('serialize() returns a YAML-shaped plain object', () => {
    const m = new HealthArchiveManifest({ userId: 'test-user', category: 'scans' });
    const out = m.serialize();
    expect(out.manifest_version).toBe(1);
    expect(out.user_id).toBe('test-user');
    expect(out.category).toBe('scans');
  });

  it('staleness returns days since lastSync', () => {
    const m = new HealthArchiveManifest({
      userId: 'test-user',
      category: 'scans',
      lastSync: new Date(Date.now() - 3 * 86400000).toISOString(),
    });
    expect(m.stalenessDays()).toBeGreaterThanOrEqual(2);
    expect(m.stalenessDays()).toBeLessThanOrEqual(4);
  });
});
