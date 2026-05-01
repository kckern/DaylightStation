import { describe, it, expect } from 'vitest';
import { HealthArchiveManifest } from '../../../../backend/src/2_domains/health/entities/HealthArchiveManifest.mjs';

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

  it('rejects unknown category', () => {
    expect(() => new HealthArchiveManifest({ userId: 'test-user', category: 'email' })).toThrow(/category/);
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
