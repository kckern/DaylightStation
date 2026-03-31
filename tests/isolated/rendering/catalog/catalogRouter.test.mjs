import { describe, it, expect, vi } from 'vitest';

describe('catalog router pipeline', () => {
  it('exports createCatalogRouter as a function', async () => {
    const { createCatalogRouter } = await import('#api/v1/routers/catalog.mjs');
    expect(typeof createCatalogRouter).toBe('function');
  });
});
