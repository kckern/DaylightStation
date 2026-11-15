/** Apply one UID-addressed structural edit without mutating the supplied list. */
export function applyListEdit(list, edit, { ids } = {}) {
  const fail = (field, message) => { const e = new Error(message); e.code = 'invalid_list_edit'; e.field = field; throw e; };
  const clone = value => {
    if (Array.isArray(value)) return value.map(clone);
    if (!value || typeof value !== 'object') return value;
    const result = { ...value };
    for (const key of Object.keys(result)) result[key] = clone(result[key]);
    return result;
  };
  if (!list || !Array.isArray(list.sections)) fail('list.sections', 'Sections are required');
  if (!edit || typeof edit !== 'object') fail('edit', 'Edit is required');
  const next = clone(list), idMap = {}, removedUids = [], used = new Set();
  const validId = (uid, field) => { if (typeof uid !== 'string' || !uid.trim()) fail(field, 'UID is required'); };
  const reserve = (uid, field) => { validId(uid, field); if (used.has(uid)) fail(field, 'UID already exists'); used.add(uid); return uid; };
  for (const s of next.sections) {
    if (!s || !Array.isArray(s.items)) fail('list.sections', 'Section items are required');
    reserve(s.uid, 'section.uid');
    for (const i of s.items) { if (!i || typeof i !== 'object') fail('item', 'Item is required'); reserve(i.uid, 'item.uid'); }
  }
  const alloc = (kind, field) => { if (typeof ids?.[kind] !== 'function') fail(field, 'ID allocator is required'); return reserve(ids[kind](), field); };
  const section = uid => { const s = next.sections.find(x => x.uid === uid); if (!s) fail('sectionUid', 'Section not found'); return s; };
  const item = uid => { for (const s of next.sections) { const index = s.items.findIndex(x => x.uid === uid); if (index >= 0) return { s, index, value: s.items[index] }; } fail('itemUid', 'Item not found'); };
  const insert = (array, value, beforeUid) => { if (beforeUid == null) return array.push(value); const index = array.findIndex(x => x.uid === beforeUid); if (index < 0 || value.uid === beforeUid) fail('beforeUid', 'Invalid insertion target'); array.splice(index, 0, value); };
  const mapId = (oldId, newId) => Object.defineProperty(idMap, oldId, { value: newId, enumerable: true, configurable: true, writable: true });
  const changes = (value, patch, forbidden) => { if (!patch || typeof patch !== 'object' || Array.isArray(patch)) fail('changes', 'Changes are required'); for (const key of forbidden) if (Object.hasOwn(patch, key)) fail(`changes.${key}`, 'Identity cannot be replaced'); Object.assign(value, clone(patch)); };
  switch (edit.type) {
    case 'add-item': { const s = section(edit.sectionUid); if (!edit.item || typeof edit.item !== 'object' || Array.isArray(edit.item)) fail('item', 'Item is required'); const v = clone(edit.item); v.uid = v.uid == null ? alloc('item', 'item.uid') : reserve(v.uid, 'item.uid'); insert(s.items, v, edit.beforeUid); break; }
    case 'update-item': { changes(item(edit.itemUid).value, edit.changes, ['uid']); break; }
    case 'move-item': { const found = item(edit.itemUid); const target = edit.toSectionUid == null ? found.s : section(edit.toSectionUid); if (edit.beforeUid === edit.itemUid) fail('beforeUid', 'Cannot move before itself'); found.s.items.splice(found.index, 1); insert(target.items, found.value, edit.beforeUid); break; }
    case 'delete-item': { const found = item(edit.itemUid); found.s.items.splice(found.index, 1); removedUids.push(found.value.uid); break; }
    case 'duplicate-item': { const found = item(edit.itemUid); const target = edit.toSectionUid == null ? found.s : section(edit.toSectionUid); const v = clone(found.value); v.uid = alloc('item', 'item.uid'); mapId(found.value.uid, v.uid); insert(target.items, v, edit.beforeUid); break; }
    case 'swap-items': { const a = item(edit.firstUid), b = item(edit.secondUid); if (a.value.uid === b.value.uid) fail('secondUid', 'Items must differ'); const av = a.value, bv = b.value; a.s.items[a.index] = { ...bv, uid: av.uid }; b.s.items[b.index] = { ...av, uid: bv.uid }; break; }
    case 'add-section': {
      if (!edit.section || typeof edit.section !== 'object' || Array.isArray(edit.section)) fail('section', 'Section is required');
      const s = clone(edit.section);
      if (s.items == null) s.items = [];
      if (!Array.isArray(s.items)) fail('section.items', 'Items must be an array');
      for (const v of s.items) {
        if (!v || typeof v !== 'object' || Array.isArray(v)) fail('item', 'Item is required');
      }
      s.uid = s.uid == null ? alloc('section', 'section.uid') : reserve(s.uid, 'section.uid');
      for (const v of s.items) {
        v.uid = v.uid == null ? alloc('item', 'item.uid') : reserve(v.uid, 'item.uid');
      }
      insert(next.sections, s, edit.beforeUid);
      break;
    }
    case 'update-section': { changes(section(edit.sectionUid), edit.changes, ['uid', 'items']); break; }
    case 'move-section': { const s = section(edit.sectionUid); if (s.uid === edit.beforeUid) fail('beforeUid', 'Cannot move before itself'); next.sections.splice(next.sections.indexOf(s), 1); insert(next.sections, s, edit.beforeUid); break; }
    case 'delete-section': { const s = section(edit.sectionUid); next.sections.splice(next.sections.indexOf(s), 1); removedUids.push(s.uid, ...s.items.map(i => i.uid)); break; }
    case 'duplicate-section': { const original = section(edit.sectionUid); const s = clone(original); s.uid = alloc('section', 'section.uid'); mapId(original.uid, s.uid); for (const v of s.items) { const old = v.uid; v.uid = alloc('item', 'item.uid'); mapId(old, v.uid); } insert(next.sections, s, edit.beforeUid); break; }
    default: fail('type', 'Unknown edit type');
  }
  return { list: next, idMap, removedUids };
}
