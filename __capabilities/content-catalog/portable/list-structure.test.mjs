import { describe, it, expect } from 'vitest';
import { applyListEdit } from './list-structure.mjs';

describe('applyListEdit', () => {
  const list = { sections: [{ uid: 's1', items: [{ uid: 'a', title: 'A', image: '/a' }, { uid: 'b', title: 'B' }] }, { uid: 's2', items: [] }] };
  const ids = { item: () => 'new-item', section: () => 'new-section' };
  it('moves an item without mutating the input', () => {
    const result = applyListEdit(list, { type: 'move-item', itemUid: 'a', toSectionUid: 's2' }, { ids });
    expect(result.list.sections.map(s => s.items.map(i => i.uid))).toEqual([['b'], ['a']]);
    expect(list.sections[0].items.map(i => i.uid)).toEqual(['a', 'b']);
  });
  it('duplicates a section with fresh IDs and a complete mapping', () => {
    let n = 0;
    const result = applyListEdit(list, { type: 'duplicate-section', sectionUid: 's1' }, { ids: { section: () => 'copy', item: () => `copy${++n}` } });
    expect(result.idMap).toEqual({ s1: 'copy', a: 'copy1', b: 'copy2' });
    expect(result.list.sections[2].items[0]).toEqual({ uid: 'copy1', title: 'A', image: '/a' });
  });
  it('swaps content without moving identities', () => {
    const result = applyListEdit(list, { type: 'swap-items', firstUid: 'a', secondUid: 'b' }, { ids });
    expect(result.list.sections[0].items).toEqual([{ uid: 'a', title: 'B' }, { uid: 'b', title: 'A', image: '/a' }]);
  });
  it('rejects missing targets and collisions', () => {
    expect(() => applyListEdit(list, { type: 'move-item', itemUid: 'a', beforeUid: 'missing' }, { ids })).toThrowError(expect.objectContaining({ code: 'invalid_list_edit' }));
    expect(() => applyListEdit(list, { type: 'add-item', sectionUid: 's1', item: { uid: 'a' } }, { ids })).toThrowError(expect.objectContaining({ code: 'invalid_list_edit' }));
  });
});

describe('UID edits and codec provenance', () => {
  const ids = { item: () => 'fresh-item', section: () => 'fresh-section' };
  const value = () => ({ sections: [{ uid: 's1', items: [{ uid: 'a', title: 'A' }, { uid: 'b', title: 'B' }] }, { uid: 's2', items: [] }] });
  it('adds and updates items and sections without replacing identities', () => {
    let list = applyListEdit(value(), { type: 'add-item', sectionUid: 's2', item: { title: 'New' } }, { ids }).list;
    list = applyListEdit(list, { type: 'update-item', itemUid: 'fresh-item', changes: { title: 'Changed' } }, { ids }).list;
    list = applyListEdit(list, { type: 'add-section', section: { title: 'Section' }, beforeUid: 's1' }, { ids }).list;
    list = applyListEdit(list, { type: 'update-section', sectionUid: 'fresh-section', changes: { title: 'Updated' } }, { ids }).list;
    expect(list.sections.map(s => s.uid)).toEqual(['fresh-section', 's1', 's2']);
    expect(list.sections[0].title).toBe('Updated');
    expect(list.sections[2].items).toEqual([{ uid: 'fresh-item', title: 'Changed' }]);
    expect(() => applyListEdit(list, { type: 'update-section', sectionUid: 's1', changes: { items: [] } }, { ids })).toThrowError(expect.objectContaining({ code: 'invalid_list_edit', field: 'changes.items' }));
  });
  it('moves sections, duplicates items, and reports all removed IDs', () => {
    let result = applyListEdit(value(), { type: 'duplicate-item', itemUid: 'a', toSectionUid: 's2' }, { ids });
    expect(result.idMap).toEqual({ a: 'fresh-item' });
    result = applyListEdit(result.list, { type: 'move-section', sectionUid: 's2', beforeUid: 's1' }, { ids });
    expect(result.list.sections.map(s => s.uid)).toEqual(['s2', 's1']);
    result = applyListEdit(result.list, { type: 'delete-item', itemUid: 'a' }, { ids });
    expect(result.removedUids).toEqual(['a']);
    result = applyListEdit(result.list, { type: 'delete-section', sectionUid: 's2' }, { ids });
    expect(result.removedUids).toEqual(['s2', 'fresh-item']);
  });
  it('retains authored title provenance across normalize, edit and serialize', async () => {
    const { normalizeListConfig, serializeListConfig } = await import('../server/list-codec.mjs');
    const list = normalizeListConfig({ sections: [{ uid: 's1', title: 'Group', items: [{ uid: 'a', title: 'Authored', input: 'files:a' }] }] });
    const result = applyListEdit(list, { type: 'update-item', itemUid: 'a', changes: { image: '/art' } }, { ids });
    expect(JSON.parse(JSON.stringify(serializeListConfig(result.list)))).toEqual({ sections: [{ uid: 's1', title: 'Group', items: [{ uid: 'a', title: 'Authored', input: 'files:a', image: '/art' }] }] });
  });
  it.each([
    { skip_after: '2030-07-10', wait_until: '2030-07-02' },
    { skipAfter: '2030-07-10', waitUntil: '2030-07-02' },
  ])('round-trips schedule fields across list normalization and serialization', async schedule => {
    const { normalizeListConfig, serializeListConfig } = await import('../server/list-codec.mjs');
    const normalized = normalizeListConfig({ sections: [{ items: [{
      uid: 'scheduled', label: 'Scheduled', input: 'plex:scheduled', ...schedule,
    }] }] });
    const stored = serializeListConfig(normalized);
    const reloaded = normalizeListConfig(stored);
    expect(reloaded.sections[0].items[0]).toMatchObject({
      skip_after: '2030-07-10',
      wait_until: '2030-07-02',
    });
  });
});

it('allocates child IDs for a new section and rejects malformed or duplicate identities', () => {
  const original = { sections: [{ uid: 'existing', items: [{ uid: 'a', title: 'A' }] }] };
  const ids = { section: () => 'new-section', item: () => 'new-item' };
  const result = applyListEdit(original, { type: 'add-section', section: { title: 'New', items: [{ title: 'Child' }] }, beforeUid: 'existing' }, { ids });
  expect(result.list.sections[0]).toEqual({ uid: 'new-section', title: 'New', items: [{ uid: 'new-item', title: 'Child' }] });
  expect(original.sections).toHaveLength(1);
  expect(() => applyListEdit({ sections: [{ uid: 's', items: [{ uid: 's' }] }] }, { type: 'delete-section', sectionUid: 's' }, { ids })).toThrowError(expect.objectContaining({ code: 'invalid_list_edit' }));
  expect(() => applyListEdit(original, { type: 'update-item', itemUid: 'a', changes: { uid: 'replacement' } }, { ids })).toThrowError(expect.objectContaining({ code: 'invalid_list_edit', field: 'changes.uid' }));
  expect(() => applyListEdit(original, { type: 'unknown' }, { ids })).toThrowError(expect.objectContaining({ code: 'invalid_list_edit', field: 'type' }));
});

it('rejects an array-valued child when adding a section', () => {
  const list = { sections: [{ uid: 's', items: [] }] };
  const edit = { type: 'add-section', section: { items: [[]] } };
  const allocations = [];
  const ids = { section: () => { allocations.push('section'); return 'new-s'; }, item: () => { allocations.push('item'); return 'new-i'; } };

  expect(() => applyListEdit(list, edit, { ids })).toThrowError(
    expect.objectContaining({ code: 'invalid_list_edit', field: 'item' })
  );
  expect(allocations).toEqual([]);
});
