// tests/isolated/adapter/persistence/DataService.content.test.mjs
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { DataService } from '#adapters/persistence/files/DataService.mjs';

/**
 * Proves DataService.content resolves under {dataDir}/content/ directly —
 * a top-level tree, sibling to household/system/users, NOT prefixed with
 * household[-{hid}]/. This is what task 10 (komga TOC) and other content/
 * migrations depend on: naively reusing dataService.household.read/write
 * for a "content/..." relative path would silently nest it under
 * data/household/content/... instead of data/content/....
 */
describe('DataService.content scope', () => {
  let tmpRoot;
  let dataDir;
  let configService;

  beforeAll(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'dataservice-content-test-'));
    dataDir = path.join(tmpRoot, 'data');
    mkdirSync(path.join(dataDir, 'content', 'komga', 'toc'), { recursive: true });
    writeFileSync(
      path.join(dataDir, 'content', 'komga', 'toc', 'book-1.yml'),
      'bookId: book-1\narticles: []\n'
    );
    configService = { getDataDir: () => dataDir };
  });

  afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('resolvePath joins dataDir + content, not household', () => {
    const dataService = new DataService({ configService });
    const resolved = dataService.content.resolvePath('komga/toc/book-1.yml');
    expect(resolved).toBe(path.join(dataDir, 'content', 'komga', 'toc', 'book-1.yml'));
  });

  test('read finds a file written directly under data/content/', () => {
    const dataService = new DataService({ configService });
    const result = dataService.content.read('komga/toc/book-1.yml');
    expect(result).toEqual({ bookId: 'book-1', articles: [] });
  });

  test('write persists under data/content/, and a subsequent read sees it', () => {
    const dataService = new DataService({ configService });
    dataService.content.write('komga/toc/book-2.yml', { bookId: 'book-2', articles: [{ page: 3 }] });
    const result = dataService.content.read('komga/toc/book-2.yml');
    expect(result).toEqual({ bookId: 'book-2', articles: [{ page: 3 }] });
  });
});
