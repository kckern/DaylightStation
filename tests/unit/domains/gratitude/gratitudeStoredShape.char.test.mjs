// Characterization test: the STORED YAML SHAPE of gratitude data must not
// change across the serialization-ownership migration (docs/_wip/plans/
// 2026-07-08-serialization-ownership-migration.md, phase 1).
// It drives GratitudeService + YamlGratitudeDatastore over an in-memory
// dataService stub and asserts the exact shape written to each file key.
// yaml.dump comparison is intentional: js-yaml dumps only own enumerable
// properties, so an accidentally-written entity (private fields) would dump
// as {} and fail loudly. This test must pass BEFORE and AFTER the refactor.
import { describe, it, expect, beforeEach } from 'vitest';
import yaml from 'js-yaml';
import { YamlGratitudeDatastore } from '#adapters/persistence/yaml/YamlGratitudeDatastore.mjs';
import { GratitudeService } from '#domains/gratitude/services/GratitudeService.mjs';

const noopLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
const HH = 'default';

function makeDataService() {
  const files = new Map();
  return {
    files,
    household: {
      read: (rel, hid) => files.get(`${hid}:${rel}`) ?? null,
      write: (rel, data, hid) => { files.set(`${hid}:${rel}`, data); }
    }
  };
}

describe('gratitude stored YAML shape (characterization)', () => {
  let ds;
  let service;

  const stored = (key) => ds.files.get(`${HH}:common/gratitude/${key}.yml`);

  beforeEach(() => {
    ds = makeDataService();
    const store = new YamlGratitudeDatastore({ dataService: ds, logger: noopLogger });
    service = new GratitudeService({ store });
  });

  it('addOption stores plain {id, text} items', async () => {
    const item = await service.addOption(HH, 'gratitude', 'Sunshine');

    const arr = stored('options.gratitude');
    expect(yaml.dump(arr)).toBe(yaml.dump([{ id: item.id, text: 'Sunshine' }]));
    expect(Object.getPrototypeOf(arr[0])).toBe(Object.prototype);
  });

  it('addSelection stores the plain selection shape and removes the option', async () => {
    const item = await service.addOption(HH, 'gratitude', 'Family');
    const sel = await service.addSelection(
      HH, 'gratitude', 'user-1', { id: item.id, text: 'Family' }, '2026-07-07T10:00:00.000Z'
    );

    expect(yaml.dump(stored('selections.gratitude'))).toBe(yaml.dump([{
      id: sel.id,
      userId: 'user-1',
      item: { id: item.id, text: 'Family' },
      datetime: '2026-07-07T10:00:00.000Z',
      printed: []
    }]));
    expect(stored('options.gratitude')).toEqual([]);
  });

  it('discardItem stores plain {id, text}; getOptions recycles discarded back into options', async () => {
    const item = await service.addOption(HH, 'hopes', 'Travel');
    await service.discardItem(HH, 'hopes', { id: item.id, text: 'Travel' });

    expect(yaml.dump(stored('discarded.hopes'))).toBe(yaml.dump([{ id: item.id, text: 'Travel' }]));
    expect(stored('options.hopes')).toEqual([]);

    // Depleted options -> recycle discarded back into options
    const options = await service.getOptions(HH, 'hopes');
    expect(options).toHaveLength(1);
    expect(options[0].text).toBe('Travel');
    expect(yaml.dump(stored('options.hopes'))).toBe(yaml.dump([{ id: item.id, text: 'Travel' }]));
    expect(stored('discarded.hopes')).toEqual([]);
  });

  it('removeSelection returns the removed selection and stores the remainder', async () => {
    const selA = await service.addSelection(
      HH, 'gratitude', 'user-1', { id: 'item-a', text: 'Health' }, '2026-07-07T10:00:00.000Z'
    );
    const selB = await service.addSelection(
      HH, 'gratitude', 'user-2', { id: 'item-b', text: 'Peace' }, '2026-07-07T10:01:00.000Z'
    );

    const removed = await service.removeSelection(HH, 'gratitude', selA.id);
    expect(removed.userId).toBe('user-1');
    expect(removed.item.text).toBe('Health');

    expect(yaml.dump(stored('selections.gratitude'))).toBe(yaml.dump([{
      id: selB.id,
      userId: 'user-2',
      item: { id: 'item-b', text: 'Peace' },
      datetime: '2026-07-07T10:01:00.000Z',
      printed: []
    }]));
  });

  it('bootstrap returns the canonical plain DTO shape (also the snapshot payload)', async () => {
    const g = await service.addOption(HH, 'gratitude', 'Sunshine');
    const h = await service.addOption(HH, 'hopes', 'Travel');
    const sel = await service.addSelection(
      HH, 'gratitude', 'user-1', { id: 'item-x', text: 'Health' }, '2026-07-07T10:00:00.000Z'
    );

    const data = await service.bootstrap(HH);

    expect(data).toEqual({
      options: {
        gratitude: [{ id: g.id, text: 'Sunshine' }],
        hopes: [{ id: h.id, text: 'Travel' }]
      },
      selections: {
        gratitude: [{
          id: sel.id,
          userId: 'user-1',
          item: { id: 'item-x', text: 'Health' },
          datetime: '2026-07-07T10:00:00.000Z',
          printed: []
        }],
        hopes: []
      },
      discarded: { gratitude: [], hopes: [] }
    });
    // Snapshot payload must be plain data, not entities
    expect(yaml.dump(data.options.gratitude)).toBe(yaml.dump([{ id: g.id, text: 'Sunshine' }]));
  });

  it('getSelectionsForPrint formats plain items with display names', async () => {
    const sel = await service.addSelection(
      HH, 'gratitude', 'user-1', { id: 'item-y', text: 'Books' }, '2026-07-07T10:00:00.000Z'
    );

    const result = await service.getSelectionsForPrint(HH, (userId) => `Name of ${userId}`);
    expect(result.gratitude).toEqual([{
      id: sel.id,
      userId: 'user-1',
      displayName: 'Name of user-1',
      item: { id: 'item-y', text: 'Books' },
      datetime: '2026-07-07T10:00:00.000Z',
      printCount: 0
    }]);
  });
});
