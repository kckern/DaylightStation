// tests/isolated/assembly/content/sourceConfigSchema.test.mjs
import { describe, test, expect } from 'vitest';
import { normalizeSourceConfig } from '#system/config/sourceConfigSchema.mjs';

describe('normalizeSourceConfig', () => {
  test('passes through new-format config', () => {
    const config = {
      sources: {
        plex: { driver: 'plex', host: 'plex.local', token: 'abc' },
        hymns: { driver: 'filesystem', content_format: 'singalong', data_path: '/data/singalong/hymn' },
      }
    };
    const result = normalizeSourceConfig(config);
    expect(result.plex.driver).toBe('plex');
    expect(result.hymns.driver).toBe('filesystem');
    expect(result.hymns.content_format).toBe('singalong');
  });

  test('converts legacy adapters format', () => {
    const legacy = {
      plex: { host: 'plex.local', token: 'abc' },
    };
    const result = normalizeSourceConfig({ adapters: legacy });
    expect(result.plex.driver).toBe('plex');
    expect(result.plex.host).toBe('plex.local');
  });

  test('merges legacy integrations config', () => {
    const config = {
      adapters: { plex: { host: 'plex.local' } },
      integrations: { plex: { token: 'abc' } },
    };
    const result = normalizeSourceConfig(config);
    expect(result.plex.host).toBe('plex.local');
    expect(result.plex.token).toBe('abc');
  });

  test('infers driver from adapter name', () => {
    const result = normalizeSourceConfig({
      adapters: {
        immich: { host: 'immich.local', apiKey: 'key' },
        audiobookshelf: { host: 'abs.local', token: 'tok' },
      }
    });
    expect(result.immich.driver).toBe('immich');
    expect(result.audiobookshelf.driver).toBe('audiobookshelf');
  });

  test('defaults unknown adapter to filesystem driver', () => {
    const result = normalizeSourceConfig({
      adapters: {
        customsource: { path: '/data/custom' },
      }
    });
    expect(result.customsource.driver).toBe('filesystem');
  });

  test('handles raw config without adapters wrapper', () => {
    const result = normalizeSourceConfig({
      plex: { host: 'plex.local' },
    });
    expect(result.plex.driver).toBe('plex');
  });

  test('skips non-object entries', () => {
    const result = normalizeSourceConfig({
      adapters: {
        plex: { host: 'plex.local' },
        bad: null,
        worse: 'string',
      }
    });
    expect(result.plex).toBeDefined();
    expect(result.bad).toBeUndefined();
    expect(result.worse).toBeUndefined();
  });
});
