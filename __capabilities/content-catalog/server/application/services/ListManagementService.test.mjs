import { describe, expect, it } from 'vitest';
import { ListConfigCodec } from '../../adapters/providers/list/ListConfigCodec.mjs';
import { ListManagementService } from './ListManagementService.mjs';
import { ValidationError } from '#apps/common/errors/SemanticErrors.mjs';

describe('ListManagementService schedule field persistence', () => {
  it('round-trips schedule and supported playback fields through adds, updates, and the list codec', () => {
    let stored = { sections: [{ title: 'Schedule', items: [{
      uid: 'existing', label: 'Existing', src: 'plex', media_key: 'existing',
      wait_until: '2030-07-02', skip_after: '2030-07-10',
      fixed_order: true, playbackrate: 0.75, shader: 'night',
      program: 'Morning', priority: 0, watched: false, progress: 0,
      summary: 'Keep this metadata', hold: true, assetId: 'asset-existing', playable: false,
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
    expect(items[0]).toMatchObject({
      program: 'Morning', priority: 0, watched: false, progress: 0,
      summary: 'Keep this metadata', hold: true, assetId: 'asset-existing', playable: false,
    });
    expect(items[1]).toMatchObject({ waitUntil: '2030-07-04', skipAfter: '2030-07-12', fixedOrder: true, playbackRate: 1.25, shader: 'minimal' });
  });
});

describe('ListManagementService item params', () => {
  function fixture() {
    let stored = { sections: [{ items: [{ uid: 'c', label: 'Charades', input: 'app:party-games/charades:fhe', action: 'Open' }] }] };
    const listStore = {
      getList: () => ListConfigCodec.normalizeListConfig(structuredClone(stored), 'fhe'),
      saveList: (_t, _n, _h, value) => { stored = ListConfigCodec.serializeListConfig(value); },
    };
    const items = () => (Array.isArray(stored) ? stored : (stored.items ?? stored.sections?.[0]?.items));
    return { service: new ListManagementService({ listStore, logger: {} }), items };
  }

  it('stores params on update and removes them with null', () => {
    const { service, items } = fixture();
    service.updateItem('menus', 'fhe', 'h', 0, { params: { autostart: true, participants: ['learner-a'] } });
    expect(items()[0].params).toEqual({ autostart: true, participants: ['learner-a'] });

    service.updateItem('menus', 'fhe', 'h', 0, { params: null });
    expect(items()[0]).not.toHaveProperty('params');
  });

  it('stores params on add', () => {
    const { service, items } = fixture();
    service.addItem('menus', 'fhe', 'h', { label: 'Other', input: 'app:party-games/charades:other', params: { autostart: false } });
    expect(items()[1].params).toEqual({ autostart: false });
  });

  it('swaps params with the content, not the row', () => {
    const { service, items } = fixture();
    service.addItem('menus', 'fhe', 'h', { label: 'Second', input: 'app:party-games/charades:two' });
    service.updateItem('menus', 'fhe', 'h', 0, { params: { autostart: true } });
    service.swapItems('menus', 'fhe', 'h', { section: 0, index: 0 }, { section: 0, index: 1 });
    expect(items()[0]).not.toHaveProperty('params');
    expect(items()[1].params).toEqual({ autostart: true });
  });

  it('rejects non-object params with a validation error', () => {
    const { service } = fixture();
    for (const bad of ['x', [], 5]) {
      const update = () => service.updateItem('menus', 'fhe', 'h', 0, { params: bad });
      const add = () => service.addItem('menus', 'fhe', 'h', { label: 'B', input: 'app:x', params: bad });
      for (const call of [update, add]) {
        expect(call).toThrow(ValidationError);
        expect(call).toThrow('params must be an object or null');
      }
    }
  });

  it('rejects params holding non-cloneable values with a validation error', () => {
    const { service, items } = fixture();
    const call = () => service.updateItem('menus', 'fhe', 'h', 0, { params: { nested: { fn: () => {} } } });
    expect(call).toThrow(ValidationError);
    expect(call).toThrow('params must contain only plain data');
    expect(items()[0]).not.toHaveProperty('params');
  });

  it('keeps existing params when an update omits them', () => {
    const { service, items } = fixture();
    service.updateItem('menus', 'fhe', 'h', 0, { params: { autostart: true } });
    service.updateItem('menus', 'fhe', 'h', 0, { label: 'Renamed' });
    expect(items()[0].label ?? items()[0].title).toBe('Renamed');
    expect(items()[0].params).toEqual({ autostart: true });
  });

  it('treats empty {} like null (removes params)', () => {
    const { service, items } = fixture();
    service.updateItem('menus', 'fhe', 'h', 0, { params: { autostart: true } });
    service.updateItem('menus', 'fhe', 'h', 0, { params: {} });
    expect(items()[0]).not.toHaveProperty('params');
    service.addItem('menus', 'fhe', 'h', { label: 'E', input: 'app:x', params: {} });
    expect(items()[1]).not.toHaveProperty('params');
  });

  it('stores a copy, not the caller object', () => {
    let saved;
    const listStore = {
      getList: () => ({ sections: [{ items: [{ label: 'Charades', input: 'app:party-games/charades:fhe' }] }] }),
      saveList: (_t, _n, _h, value) => { saved = value; },
    };
    const service = new ListManagementService({ listStore, logger: {} });
    const params = { autostart: true, participants: ['learner-a'] };
    service.updateItem('menus', 'fhe', 'h', 0, { params });
    params.autostart = false;
    params.participants.push('learner-b');
    expect(saved.sections[0].items[0].params).toEqual({ autostart: true, participants: ['learner-a'] });
  });
});
