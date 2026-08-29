import { describe, expect, it } from 'vitest';
import { RegistryContentCatalogGateway } from './RegistryContentCatalogGateway.mjs';

describe('RegistryContentCatalogGateway prewarm compatibility', () => {
  it('owns the legacy unsupported-provider reason returned to the API', async () => {
    const source = { source: 'poem' };
    const registry = {
      get: (name) => name === 'poem' ? source : null,
      list: () => ['poem'],
      getByProvider: () => [],
      getByCategory: () => [],
    };
    const catalog = new RegistryContentCatalogGateway({ registry });

    await expect(catalog.preparePlayback(
      { source: 'poem', localId: 'remedy/01' },
      { id: 'poem:remedy/01' },
      { startOffset: 0 },
    )).resolves.toEqual({ kind: 'unsupported', reason: 'not plex' });
  });
});
