import { describe, it, expect } from 'vitest';
import { ListMenuProjector } from '../list-menu-projector.mjs';
import { normalizeListConfig, serializeListConfig } from '../list-codec.mjs';

describe('ListMenuProjector', () => {
  it('projects authored order and decorates runtime actions without changing the persisted list', async () => {
    const list = normalizeListConfig({ title: 'Gathering', sections: [
      { title: 'Opening', items: [
        { uid: 'i1', label: 'Welcome', input: 'app:welcome', action: 'Open' },
        { uid: 'hidden', label: 'Hidden', input: 'files:hidden', active: false },
      ] },
      { title: 'Closing', items: [{ uid: 'i2', label: 'Song', input: 'files:song', image: '/cover.jpg', resume: false }] },
    ] });
    const before = serializeListConfig(list);
    const projector = new ListMenuProjector({ registry: null });
    const result = await projector.project({ list, sourceId: 'fixture', order: 'authored', actionDecorator: ({ resolved }) => {
      const key = resolved.actions.open ? 'open' : 'play';
      resolved.actions[key].launchContext = { participant: 'guest' };
      return resolved;
    } });
    expect(result.items.map(item => item.metadata.uid)).toEqual(['i1', 'i2']);
    expect(result.items[0].actions.open).toEqual({ app: 'welcome', launchContext: { participant: 'guest' } });
    expect(result.items[1].thumbnail).toBe('/cover.jpg');
    expect(result.items[1].actions.play.resume).toBe(false);
    expect(serializeListConfig(list)).toEqual(before);
  });
});

describe('projection resource and action boundaries', () => {
  it('uses injected UID artwork and preserves item getters', async () => {
    const list = normalizeListConfig({ items: [{ uid: 'i1', title: 'Authored', input: 'files:clip' }] });
    const projector = new ListMenuProjector({ artworkForUid: uid => `/art/${uid}.jpg` });
    const menu = await projector.project({ list, sourceId: 'menu:fixture' });
    expect(menu.id).toBe('menu:fixture');
    expect(menu.items[0].thumbnail).toBe('/art/i1.jpg');
    expect(menu.items[0].label).toBe('Authored');
    expect(menu.items[0].getLocalId()).toBe('clip');
  });
  it('discards unreturned runtime decorations and leaves the source intact', async () => {
    const list = normalizeListConfig({ items: [{ uid: 'i1', title: 'Authored', play: { contentId: 'files:clip', overlay: { queue: 'x' } } }] });
    const before = JSON.stringify(list);
    const menu = await new ListMenuProjector().project({ list, sourceId: 'menu:fixture', actionDecorator: ({ item, resolved }) => {
      item.play.overlay.queue = 'changed';
      resolved.actions.play.overlay.queue = 'changed';
    } });
    expect(menu.items[0].actions.play.overlay.queue).toBe('x');
    expect(JSON.stringify(list)).toBe(before);
  });
});

it('applies only returned runtime actions and keeps the projected identity and label', async () => {
  const list = normalizeListConfig({ items: [{ uid: 'i', title: 'Original', input: 'files:clip' }] });
  const result = await new ListMenuProjector().project({ list, sourceId: 'menu:fixture', actionDecorator: ({ resolved }) => {
    resolved.title = 'Changed';
    resolved.actions.play.context = { launch: 'runtime' };
    return resolved;
  } });
  expect(result.items[0].title).toBe('Original');
  expect(result.items[0].actions.play.context).toEqual({ launch: 'runtime' });
  expect(result.items[0].getLocalId()).toBe('clip');
});
