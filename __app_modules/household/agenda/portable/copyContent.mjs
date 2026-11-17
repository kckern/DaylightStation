import { cloneListValue } from '../../../../__capabilities/content-catalog/portable/list-structure.mjs';
import { remapSetup } from './planEdits.mjs';
function invalid(field, message) { const error = new Error(message); error.field = field; error.code = 'invalid_agenda'; throw error; }
export function copyContent({source, ids, displaySnapshots, remapActivitySettings, reservedIds = [], imageRefs = {}}) {
  const participantKeyMap = {}, itemUidMap = {}, sectionUidMap = {}, used = new Set(reservedIds);
  const alloc = kind => {
    if (typeof ids?.[kind] !== 'function') invalid(`ids.${kind}`, 'ID allocator required');
    const id = ids[kind]();
    if (typeof id !== 'string' || !id.trim() || used.has(id)) invalid(`ids.${kind}`, 'Unique ID required');
    used.add(id); return id;
  };
  if (source.plan_id) used.add(source.plan_id);
  for (const p of source.participants) used.add(p.id);
  for (const s of source.list.sections) { used.add(s.uid); for (const i of s.items) used.add(i.uid); }
  const participants = cloneListValue(source.participants);
  for (const p of participants) {
    const old = p.id; p.id = alloc('rosterEntry'); participantKeyMap[old] = p.id;
    if (p.person && displaySnapshots) p.display = cloneListValue(displaySnapshots[`${p.person.kind}:${p.person.id}`]);
    if (!p.display || !p.display.name || !Object.hasOwn(p.display,'avatar')) invalid('participants.display','Display snapshot required');
  }
  const list = cloneListValue(source.list);
  for (const section of list.sections) {
    const old = section.uid; section.uid = alloc('section'); sectionUidMap[old] = section.uid;
    for (const item of section.items) { const oldItem = item.uid; if (!item.image && Object.hasOwn(imageRefs, oldItem) && imageRefs[oldItem]) item.image = imageRefs[oldItem]; item.uid = alloc('item'); itemUidMap[oldItem] = item.uid; }
  }
  const activity_settings = {};
  for (const [uid, setup] of Object.entries(source.activity_settings)) {
    if (!Object.hasOwn(itemUidMap,uid)) invalid(`activity_settings.${uid}`,'Dangling activity settings');
    activity_settings[itemUidMap[uid]] = remapSetup(setup,participantKeyMap,itemUidMap,remapActivitySettings);
  }
  return {participants,list,activity_settings,idMap:{participantKeyMap,itemUidMap,sectionUidMap},alloc};
}

/** Replace editable content without changing a plan's creation provenance or identity. */
export function replaceDraftContent(plan, copied) {
  return {
    ...plan,
    participants: copied.participants,
    list: copied.list,
    activity_settings: copied.activity_settings,
  };
}
