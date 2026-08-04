import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSchoolCatalog } from './schoolCatalog.mjs';

describe('shared School Catalog composition', () => {
  it('wires a surface-neutral Catalog even when SchoolCalc is absent', async () => {
    const configService = {
      getHouseholdAppConfig: () => ({ catalog: { content: { root: 'mounted/learning' } } }),
      getDataDir: () => '/data',
      getHouseholdPath: (relative) => path.resolve('/data/household', relative),
    };
    const catalog = createSchoolCatalog({ configService });
    expect(catalog).toMatchObject({ wired: true, query: expect.any(Object) });
    expect(catalog.diagnostics.contentRoot).toBe(path.resolve('/data/mounted/learning'));
    await expect(catalog.query.list()).resolves.toEqual({ schema: 'school.catalog-index/v1', catalogs: [] });
  });

  it('may be explicitly disabled without constructing a device product', () => {
    const catalog = createSchoolCatalog({
      configService: {
        getHouseholdAppConfig: () => ({ catalog: { enabled: false } }),
        getDataDir: () => '/data',
        getHouseholdPath: (relative) => path.resolve('/data/household', relative),
      },
    });
    expect(catalog).toMatchObject({ wired: false, query: null });
  });
});
