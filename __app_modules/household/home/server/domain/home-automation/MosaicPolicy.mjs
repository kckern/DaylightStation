/**
 * MosaicPolicy — how the device mosaic groups entities, as household policy
 * decides it (`mosaic:` in the dashboard YAML), and `arrangeMosaic`, which
 * lays entities out into room groups and type groups.
 *
 * @module home-automation/MosaicPolicy
 */

import { ValidationError } from '#domains/core/errors/index.mjs';
import { ENTITY_TYPES } from './EntityCatalogPolicy.mjs';

const SLUG = /^[a-z0-9_-]+$/;
const TYPE_IDS = ENTITY_TYPES.map((t) => t.id);
const ELSEWHERE = Object.freeze({ id: '_elsewhere', label: 'Elsewhere' });

function invalid(message, field, value) {
  return new ValidationError(`mosaic ${message}`, { code: 'INVALID_MOSAIC_POLICY', field, value });
}

function list(value, field) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw invalid(`${field} must be a list`, field, value);
  return value;
}

function stringList(value, field) {
  const items = list(value, field);
  if (items.some((v) => typeof v !== 'string' || !v)) throw invalid(`${field} must be a list of strings`, field, value);
  return items;
}

function slugList(value, field) {
  const items = stringList(value, field);
  const bad = items.find((v) => !SLUG.test(v));
  if (bad !== undefined) throw invalid(`${field} entries must be slugs`, field, bad);
  return items;
}

function typeList(value, field) {
  const items = stringList(value, field);
  const bad = items.find((v) => !TYPE_IDS.includes(v));
  if (bad !== undefined) throw invalid(`${field} entries must be one of ${TYPE_IDS.join(', ')}`, field, bad);
  return items;
}

function parseMerge(raw, i, seen, claimed) {
  const at = (key) => `mosaic.merge_rooms[${i}].${key}`;
  if (!raw || typeof raw !== 'object') throw invalid(`merge_rooms[${i}] must be an object`, `mosaic.merge_rooms[${i}]`, raw);
  if (typeof raw.id !== 'string' || !SLUG.test(raw.id)) throw invalid(`${at('id')} must be a slug`, at('id'), raw.id);
  if (seen.has(raw.id)) throw invalid(`${at('id')} duplicates an earlier merge`, at('id'), raw.id);
  seen.add(raw.id);
  if (!Array.isArray(raw.rooms) || raw.rooms.length === 0) {
    throw invalid(`${at('rooms')} must be a non-empty list`, at('rooms'), raw.rooms);
  }
  const rooms = slugList(raw.rooms, at('rooms'));
  // A room in two merges would land in whichever came first.
  const twice = rooms.find((r) => claimed.has(r));
  if (twice !== undefined) throw invalid(`${at('rooms')} lists a room an earlier merge already takes`, at('rooms'), twice);
  for (const r of rooms) claimed.add(r);
  let label = raw.id;
  if (raw.label != null) {
    if (typeof raw.label !== 'string' || !raw.label) throw invalid(`${at('label')} must be a string`, at('label'), raw.label);
    label = raw.label;
  }
  return Object.freeze({ id: raw.id, label, rooms: Object.freeze(rooms) });
}

const globCache = new Map();
function globToRegExp(glob) {
  if (!globCache.has(glob)) {
    const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    globCache.set(glob, new RegExp(`^${escaped}$`));
  }
  return globCache.get(glob);
}

function matchesAny(entityId, globs) {
  const objectId = entityId.slice(entityId.indexOf('.') + 1);
  return globs.some((g) => globToRegExp(g).test(entityId) || globToRegExp(g).test(objectId));
}

export class MosaicPolicy {
  #p;

  constructor(props) {
    this.#p = Object.freeze(props);
    Object.freeze(this);
  }

  /** @param {Object} [mosaic] - the `mosaic:` YAML section */
  static fromConfig(mosaic) {
    const m = mosaic || {};
    const mergesRaw = list(m.merge_rooms, 'mosaic.merge_rooms');
    const seen = new Set();
    const claimed = new Set();
    const typeOrder = typeList(m.type_order, 'mosaic.type_order');
    const merges = mergesRaw.map((r, i) => parseMerge(r, i, seen, claimed));
    // A merge named like a room would share that room's group key.
    merges.forEach((merge, i) => {
      if (claimed.has(merge.id)) throw invalid(`merge_rooms[${i}].id is also a room a merge lists`, `mosaic.merge_rooms[${i}].id`, merge.id);
    });
    return new MosaicPolicy({
      hide: Object.freeze(stringList(m.hide, 'mosaic.hide')),
      roomOrder: Object.freeze(slugList(m.room_order, 'mosaic.room_order')),
      merges: Object.freeze(merges),
      typeGroups: Object.freeze(typeList(m.type_groups, 'mosaic.type_groups')),
      // Listed types first; unlisted ones keep their default order after them.
      typeOrder: Object.freeze([...typeOrder, ...TYPE_IDS.filter((id) => !typeOrder.includes(id))]),
    });
  }

  get hide() { return this.#p.hide; }
  get roomOrder() { return this.#p.roomOrder; }
  get merges() { return this.#p.merges; }
  get typeGroups() { return this.#p.typeGroups; }
  get typeOrder() { return this.#p.typeOrder; }

  isHidden(entityId) { return matchesAny(entityId, this.#p.hide); }

}

const byText = (a, b) => String(a).localeCompare(String(b));

export function arrangeMosaic(entities, policy, { types = [] } = {}) {
  const typeLabel = new Map(types.map((t) => [t.id, t.label]));
  const labelOf = (id) => typeLabel.get(id) ?? id;
  const typeRank = (type) => {
    const i = policy.typeOrder.indexOf(type);
    return i === -1 ? policy.typeOrder.length : i;
  };
  const roomLabel = (e) => e.room?.name ?? '';
  const visible = entities.filter((e) => !policy.isHidden(e.id));

  const byTypeThenName = (a, b) => typeRank(a.type) - typeRank(b.type) || byText(a.name, b.name);

  const mergeOf = new Map();
  for (const m of policy.merges) for (const r of m.rooms) if (!mergeOf.has(r)) mergeOf.set(r, m);

  const roomGroups = new Map();
  const typeGroups = new Map();
  const elsewhere = [];
  for (const e of visible) {
    if (policy.typeGroups.includes(e.type)) {
      if (!typeGroups.has(e.type)) typeGroups.set(e.type, []);
      typeGroups.get(e.type).push(e);
    } else if (!e.room) {
      elsewhere.push(e);
    } else {
      const m = mergeOf.get(e.room.id);
      // Merges live in their own key space, so a real room that shares a
      // merge's id keeps its own group instead of joining the merge.
      const key = m ? `merge:${m.id}` : e.room.id;
      if (!roomGroups.has(key)) roomGroups.set(key, { key, id: m ? m.id : e.room.id, label: m ? m.label : e.room.name, members: [] });
      roomGroups.get(key).members.push(e);
    }
  }

  // A merge keeps its own id as the group id unless a real room drawn
  // alongside it has that id too; then the merge's is namespaced, so every
  // group id stays unique.
  const realRoomIds = new Set([...roomGroups.values()].filter((g) => !g.key.startsWith('merge:')).map((g) => g.id));
  for (const g of roomGroups.values()) {
    if (g.key.startsWith('merge:') && realRoomIds.has(g.id)) g.publicId = g.key;
  }

  const rank = (id) => {
    const i = policy.roomOrder.indexOf(id);
    return i === -1 ? Infinity : i;
  };
  const rooms = [...roomGroups.values()].sort((a, b) => {
    const ra = rank(a.id); const rb = rank(b.id);
    if (ra !== rb) return ra === Infinity ? 1 : rb === Infinity ? -1 : ra - rb;
    return byText(a.label, b.label);
  });

  const toGroup = (id, label, members) => ({ id, label, entityIds: [...members].sort(byTypeThenName).map((e) => e.id) });
  const typeGroupList = [...typeGroups.entries()]
    .sort(([a], [b]) => typeRank(a) - typeRank(b))
    .map(([t, members]) => toGroup(`type:${t}`, labelOf(t), members));

  const byRoom = [
    ...rooms.map((g) => toGroup(g.publicId ?? g.id, g.label, g.members)),
    ...typeGroupList,
    ...(elsewhere.length ? [toGroup(ELSEWHERE.id, ELSEWHERE.label, elsewhere)] : []),
  ];

  const typed = new Map();
  for (const e of visible) {
    if (!typed.has(e.type)) typed.set(e.type, []);
    typed.get(e.type).push(e);
  }
  const byType = [...typed.entries()]
    .sort(([a], [b]) => typeRank(a) - typeRank(b))
    .map(([t, members]) => ({
      id: t,
      label: labelOf(t),
      entityIds: [...members]
        .sort((a, b) => {
          if (!a.room !== !b.room) return a.room ? -1 : 1;
          return byText(roomLabel(a), roomLabel(b)) || byText(a.name, b.name);
        })
        .map((e) => e.id),
    }));

  return { byRoom, byType };
}

/**
 * The merges whose id is also a real room's id (the platform's rooms). Not a
 * config error — the platform can add a room at any time — but worth a warning:
 * `arrangeMosaic` keeps the two groups apart.
 * @param {MosaicPolicy} policy
 * @param {Iterable<string>} roomIds
 * @returns {Array<{mergeId: string, roomId: string}>}
 */
export function mergeShadows(policy, roomIds) {
  const known = new Set(roomIds);
  return policy.merges.filter((m) => known.has(m.id)).map((m) => ({ mergeId: m.id, roomId: m.id }));
}
