import { describe, expect, it } from 'vitest';
import { scanDirectFsImports } from '../../../scripts/audit-direct-fs-imports.mjs';

describe('direct filesystem import gate', () => {
  it('flags fs imports in adapters, applications, rendering, domains, and API', () => {
    for (const layer of ['1_adapters', '1_rendering', '2_domains', '3_applications', '4_api', '5_composition']) {
      const findings = scanDirectFsImports(
        `backend/src/${layer}/feature/File.mjs`,
        "import { promises as fs } from 'node:fs';",
      );
      expect(findings, layer).toHaveLength(1);
    }
  });

  it('flags raw filesystem imports in the backend runtime entrypoint', () => {
    expect(scanDirectFsImports(
      'backend/index.js',
      "import { existsSync } from 'node:fs';",
    )).toHaveLength(1);
  });

  it('catches dynamic imports and CommonJS requires', () => {
    const source = "const a = await import('fs/promises'); const b = require('node:fs'); const c = module.require(`node:fs/promises`); const d = await import(`node:fs`);";
    expect(scanDirectFsImports('backend/src/1_adapters/x/File.mjs', source)).toHaveLength(4);
  });

  it('catches re-exports from filesystem modules', () => {
    const source = "export { readFile } from 'fs'; export * from 'node:fs/promises';";
    expect(scanDirectFsImports('backend/src/1_adapters/x/File.mjs', source)).toHaveLength(2);
  });

  it('allows raw filesystem access only in the system layer', () => {
    const source = "import fs from 'node:fs';";
    expect(scanDirectFsImports('backend/src/0_system/utils/FileIO.mjs', source)).toEqual([]);
    expect(scanDirectFsImports('backend/src/5_composition/bootstrap.mjs', source)).toHaveLength(1);
  });

  it('does not police test fixtures', () => {
    expect(scanDirectFsImports(
      'backend/src/1_adapters/x/File.test.mjs',
      "import fs from 'node:fs';",
    )).toEqual([]);
  });
});
