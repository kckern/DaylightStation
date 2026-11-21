import { describe, expect, it } from 'vitest';
import { ListConfigCodec } from '../../adapters/providers/list/ListConfigCodec.mjs';
import { ListManagementService } from './ListManagementService.mjs';

describe('ListManagementService schedule field persistence', () => {
  it('round-trips schedule and supported playback fields through adds, updates, and the list codec', () => {
    let stored = { sections: [{ title: 'Schedule', items: [{
      uid: 'existing', label: 'Existing', src: 'plex', media_key: 'existing',
      wait_until: '2030-07-02', skip_after: '2030-07-10',
      fixed_order: true, playbackrate: 0.75, shader: 'night',
    }] }] };
    const listStore = {
      getList: () => ListConfigCodec.normalizeListConfig(structuredClone(stored), 'fixture'),
      saveList: (_type, _name, _householdId, value) => { stored = ListConfigCodec.serializeListConfig(value); },
    };
    const service = new ListManagementService({ listStore, logger: {} });

    service.updateItem('watchlists', 'fixture', 'household', 0, {
      waitUntil: '2030-07-03',
      skipAfter: '2030-07-11',
      fixedOrder: false,
      playbackRate: 1,
      shader: null,
    });
    service.addItem('watchlists', 'fixture', 'household', {
      label: 'Added',
      input: 'plex:added',
      waitUntil: '2030-07-04',
      skipAfter: '2030-07-12',
      fixedOrder: true,
      playbackRate: 1.25,
      shader: 'minimal',
    });

    const items = service.getList('watchlists', 'fixture', 'household').sections[0].items;
    expect(items[0]).toMatchObject({ waitUntil: '2030-07-03', skipAfter: '2030-07-11', fixedOrder: false, playbackRate: 1 });
    expect(items[0].shader).toBeUndefined();
    expect(items[1]).toMatchObject({ waitUntil: '2030-07-04', skipAfter: '2030-07-12', fixedOrder: true, playbackRate: 1.25, shader: 'minimal' });
  });
});
