import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { YamlDocumentFileStore } from './YamlDocumentFileStore.mjs';

const roots = [];

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yaml-document-store-'));
  roots.push(root);
  return { root, store: new YamlDocumentFileStore() };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('YamlDocumentFileStore', () => {
  it('returns the supplied fallback only for an absent document', async () => {
    const { root, store } = await fixture();

    expect(store.read(path.join(root, 'missing.yml'), { fresh: true })).toEqual({ fresh: true });
  });

  it('writes, lists, reads YAML, and exposes raw bytes', async () => {
    const { root, store } = await fixture();
    const file = path.join(root, 'nested', 'record.yml');

    expect(store.write(file, { id: 'record-1', values: [1, 2] })).toEqual({ id: 'record-1', values: [1, 2] });
    expect(store.exists(file)).toBe(true);
    expect(store.list(path.dirname(file))).toEqual(['record.yml']);
    expect(store.read(file)).toEqual({ id: 'record-1', values: [1, 2] });
    expect(store.readBytes(file)).toBeInstanceOf(Buffer);
  });
});
