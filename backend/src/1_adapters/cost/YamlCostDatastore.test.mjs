import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { beforeEach, describe, expect, it } from 'vitest';
import yaml from 'yaml';
import { YamlCostDatastore } from './YamlCostDatastore.mjs';

let dataRoot;

beforeEach(async () => {
  dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cost-store-'));
});

describe('YamlCostDatastore default FileIO', () => {
  it('returns no entries for a month that has not been recorded', async () => {
    const store = new YamlCostDatastore({ dataRoot });

    await expect(store.findByPeriod(new Date('2026-08-01T00:00:00Z'), new Date('2026-08-31T23:59:59Z')))
      .resolves.toEqual([]);
  });

  it('writes a month-partitioned YAML entry through its default IO', async () => {
    const store = new YamlCostDatastore({ dataRoot });
    const serialized = { id: 'cost-1', occurredAt: '2026-08-15T12:00:00Z', amount: 5 };

    await store.save({ id: 'cost-1', occurredAt: new Date(serialized.occurredAt), toJSON: () => serialized });

    const file = path.join(dataRoot, '2026-08', 'entries.yml');
    expect(yaml.parse(await fs.readFile(file, 'utf8'))).toEqual({ entries: [serialized] });
  });
});
