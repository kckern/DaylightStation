import { applyListEdit, cloneListValue } from '../../../../__capabilities/content-catalog/portable/list-structure.mjs';

function fail(field, message) {
  const error = new Error(message);
  error.field = field;
  error.code = 'invalid_plan_edit';
  throw error;
}

export function remapSetup(setup, participantKeyMap, itemUidMap, remapActivitySettings) {
  const next = cloneListValue(setup);
  if (next.participants.mode === 'explicit') {
    next.participants.ids = next.participants.ids
      .map(id => Object.hasOwn(participantKeyMap, id) ? participantKeyMap[id] : id)
      .filter(id => id !== null);
  }
  if (typeof remapActivitySettings !== 'function') {
    fail('remapActivitySettings', 'Consumer settings remapper is required');
  }
  next.settings = remapActivitySettings({
    consumer: cloneListValue(next.consumer),
    settings: next.settings,
    participantKeyMap: {...participantKeyMap},
    itemUidMap: {...itemUidMap},
  });
  return next;
}

const ACTIONS = ['open', 'play', 'queue', 'display'];
export function itemActions(item) {
  return ACTIONS.filter(action => Boolean(item?.[action]));
}

/** Return the single effective action, or null for a missing or ambiguous action. */
export function itemAction(item) {
  const actions = itemActions(item);
  return actions.length === 1 ? actions[0] : null;
}

function assertBindings(plan) {
  const items = new Map(plan.list.sections.flatMap(section => section.items.map(item => [item.uid, item])));
  const roster = new Set(plan.participants.map(participant => participant.id));
  for (const [uid, item] of items) {
    if (itemActions(item).length > 1) fail(`list.items.${uid}`, 'Multiple authored actions are not allowed');
  }
  for (const [uid, setup] of Object.entries(plan.activity_settings)) {
    if (!items.has(uid) || !itemAction(items.get(uid)) || itemAction(items.get(uid)) !== setup.action) {
      fail(`activity_settings.${uid}`, 'Activity binding is invalid');
    }
    if (setup.participants.mode === 'explicit' &&
        (!Array.isArray(setup.participants.ids) || setup.participants.ids.some(id => !roster.has(id)))) {
      fail(`activity_settings.${uid}.participants`, 'Participant binding is invalid');
    }
  }
}

function assertUniquePeople(participants) {
  const seen = new Set();
  for (const participant of participants) {
    if (!participant.person) continue;
    const key = `${participant.person.kind}:${participant.person.id}`;
    if (seen.has(key)) fail('participants', 'Duplicate named participant');
    seen.add(key);
  }
}

/** Apply a UID-addressed plan edit, preserving identities and local bindings. */
export function applyPlanEdit(plan, edit, {ids, remapActivitySettings, imageRefs = {}} = {}) {
  assertBindings(plan);
  const next = cloneListValue(plan);
  if (edit.type === 'delete-participant') {
    const index = next.participants.findIndex(p => p.id === edit.participantId);
    if (index < 0) fail('participantId', 'Participant not found');
    next.participants.splice(index, 1);
    for (const [uid, setup] of Object.entries(next.activity_settings)) {
      next.activity_settings[uid] = remapSetup(setup, {[edit.participantId]: null}, {}, remapActivitySettings);
    }
    assertBindings(next);
    return next;
  }
  if (edit.type === 'add-participant') {
    if (typeof ids?.rosterEntry !== 'function') fail('ids.rosterEntry', 'ID allocator required');
    const participant = cloneListValue(edit.participant);
    participant.id = ids.rosterEntry();
    if (!participant.id || next.participants.some(p => p.id === participant.id)) {
      fail('participant.id', 'Invalid participant ID');
    }
    next.participants.push(participant);
    assertUniquePeople(next.participants);
    return next;
  }
  if (edit.type === 'update-participant') {
    const participant = next.participants.find(p => p.id === edit.participantId);
    if (!participant || !edit.changes || Object.hasOwn(edit.changes, 'id')) {
      fail('participantId', 'Invalid participant edit');
    }
    Object.assign(participant, cloneListValue(edit.changes));
    assertUniquePeople(next.participants);
    return next;
  }
  const result = applyListEdit(next.list, edit, {ids});
  next.list = result.list;
  for (const [oldUid, newUid] of Object.entries(result.idMap)) {
    if (!Object.hasOwn(imageRefs, oldUid) || !imageRefs[oldUid]) continue;
    const item = next.list.sections.flatMap(section => section.items).find(value => value.uid === newUid);
    if (item && !item.image) item.image = imageRefs[oldUid];
  }
  for (const uid of result.removedUids) delete next.activity_settings[uid];
  if (edit.type === 'swap-items') {
    const a = next.activity_settings[edit.firstUid];
    const b = next.activity_settings[edit.secondUid];
    const itemMap = {[edit.firstUid]: edit.secondUid, [edit.secondUid]: edit.firstUid};
    delete next.activity_settings[edit.firstUid];
    delete next.activity_settings[edit.secondUid];
    if (a) next.activity_settings[edit.secondUid] = remapSetup(a, {}, itemMap, remapActivitySettings);
    if (b) next.activity_settings[edit.firstUid] = remapSetup(b, {}, itemMap, remapActivitySettings);
  } else {
    for (const [oldUid, newUid] of Object.entries(result.idMap)) {
      if (next.activity_settings[oldUid]) {
        next.activity_settings[newUid] = remapSetup(next.activity_settings[oldUid], {}, result.idMap, remapActivitySettings);
      }
    }
  }
  assertBindings(next);
  return next;
}
