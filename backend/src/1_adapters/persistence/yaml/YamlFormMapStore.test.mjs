import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { YamlFormMapStore } from './YamlFormMapStore.mjs';

let dir;
let store;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'form-map-store-'));
  store = new YamlFormMapStore({
    configService: { getHouseholdPath: (relativePath) => path.join(dir, relativePath) },
  });
});

describe('YamlFormMapStore', () => {
  it('round-trips a map at its stable form id', async () => {
    const formMap = { artifactId: 'issued-1', marks: [{ question: 1, x: 10, y: 20 }] };

    await store.put('issued-1', formMap);

    await expect(store.get('issued-1')).resolves.toEqual(formMap);
  });

  it('retains the original geometry when the same form id is issued again', async () => {
    const original = { marks: [{ question: 1, x: 10, y: 20 }] };
    const replacement = { marks: [{ question: 1, x: 30, y: 40 }] };

    await store.put('issued-1', original);
    await expect(store.put('issued-1', replacement)).resolves.toEqual(original);
    await expect(store.get('issued-1')).resolves.toEqual(original);
  });

  it('treats unreadable stored data as unavailable without exposing a parse error', async () => {
    const file = path.join(dir, 'school/artifacts/print/forms/issued-1.yml');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'marks: { broken', 'utf8');

    await expect(store.get('issued-1')).resolves.toBeNull();
  });
});
