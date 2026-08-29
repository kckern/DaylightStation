import { describe, expect, it, vi } from 'vitest';
import { LegacyLocalContentService } from './LegacyLocalContentService.mjs';

function repository(overrides = {}) {
  return {
    isConfigured: () => true,
    resolveScripture: () => ({ volume: 'bom', version: 'se', verseId: '31103' }),
    getItem: vi.fn(async () => ({
      id: '31103', title: '1 Nephi 1', duration: 12,
      metadata: { reference: '1 Nephi 1', verses: [{ text: 'I, Nephi' }] },
    })),
    generateScriptureReference: () => '1 Nephi 1',
    resolveAudioDuration: async () => 0,
    ...overrides,
  };
}

describe('LegacyLocalContentService', () => {
  it('returns a semantic scripture result with no HTTP envelope or API URL', async () => {
    const result = await new LegacyLocalContentService({ repository: repository() }).getScripture('1-nephi-1');
    expect(result).toEqual({
      kind: 'found',
      value: {
        input: '1-nephi-1', reference: '1 Nephi 1', volume: 'bom', version: 'se',
        verseId: '31103', assetId: 'bom/se/31103', duration: 12, verses: [{ text: 'I, Nephi' }],
      },
    });
    expect(result).not.toHaveProperty('status');
    expect(result).not.toHaveProperty('body');
    expect(JSON.stringify(result)).not.toContain('/api/');
  });

  it('uses semantic invalid, missing, and unconfigured outcomes', async () => {
    const invalid = new LegacyLocalContentService({ repository: repository({ resolveScripture: () => null }) });
    const missing = new LegacyLocalContentService({ repository: repository({ getItem: async () => null }) });
    const unconfigured = new LegacyLocalContentService({ repository: repository({ isConfigured: () => false }) });
    expect(await invalid.getScripture('bad')).toEqual({ kind: 'invalid', input: 'bad' });
    expect(await missing.getScripture('1-nephi-1')).toEqual({ kind: 'not_found', input: '1-nephi-1', resolved: 'bom/se/31103' });
    expect(await unconfigured.getScripture('1-nephi-1')).toEqual({ kind: 'unconfigured' });
  });
});
