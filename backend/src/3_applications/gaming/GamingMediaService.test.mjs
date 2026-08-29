import { describe, expect, it, vi } from 'vitest';
import { GamingMediaService } from './GamingMediaService.mjs';

describe('GamingMediaService', () => {
  it('returns semantic catalog data and leaves API URLs to the HTTP adapter', () => {
    const repository = { getCatalog: vi.fn(() => ({
      schema_version: 1,
      pack: { id: 'default' },
      assets: {
        approved: { status: 'approved', source: '/private/a.png', source_sha256: 'secret', label: 'A' },
        pending: { status: 'pending', source: '/private/b.png' },
      },
    })) };
    const result = new GamingMediaService({ repository }).getCatalog('default');
    expect(result).toEqual({
      kind: 'found',
      value: { schemaVersion: 1, pack: { id: 'default' }, assets: { approved: { status: 'approved', label: 'A' } } },
    });
    expect(JSON.stringify(result)).not.toContain('/api/');
    expect(result).not.toHaveProperty('status');
  });

  it('expresses repository absence as domain-level outcomes', () => {
    const unavailable = new GamingMediaService({ repository: { getCatalog: () => undefined } });
    const missing = new GamingMediaService({ repository: { getCatalog: () => null } });
    expect(unavailable.getCatalog('default')).toEqual({ kind: 'unavailable' });
    expect(missing.getCatalog('default')).toEqual({ kind: 'not_found' });
  });
});
