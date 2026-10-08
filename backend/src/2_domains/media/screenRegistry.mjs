/**
 * Household screen registry — pure rules (RQ-HOUSE-06, RQ-HOUSE-08, RQ-AUTO-02).
 *
 * One list of every screen in the house, under a human name that is unique
 * household-wide (case-insensitive). Three kinds of id, all stable:
 *
 *   fleet:<devices.yml key>   a configured TV / kiosk / speaker. devices.yml is
 *                             the read-only source of its name and room; a
 *                             rename or room change made in the app is an
 *                             override stored here, never a devices.yml write.
 *   browser:<clientId>        a browser running the app (frontend
 *                             browserIdentity). Registered the first time it
 *                             announces itself or is named.
 *   screen:<slug>             a screen a person added by hand, before (or
 *                             without) any device reporting under it.
 *
 * Routines target the stable id, never the name, so a rename cannot break one.
 *
 * Persisted state (see YamlScreenRegistryDatastore):
 *
 *   screens: { <id>: { name, room, firstSeen, lastSeen, renames: [{from,to,at}],
 *                      retiredAt, source: 'seen'|'added'|'configured' } }
 *   aliases: { <duplicate id>: { into, mergedAt } }
 *
 * For a configured screen `name`/`room` are null unless overridden.
 *
 * @module domains/media/screenRegistry
 */
import { DomainInvariantError } from '#domains/core/errors/index.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

export const SCREEN_DEFAULTS = Object.freeze({
  maxNameLength: 48,
  // RQ-HOUSE-06: "(was <old name>)" is shown for a week after a rename.
  wasNameWindowMs: 7 * DAY_MS,
  // RQ-HOUSE-08: screens silent for 30 days fold into "Not seen lately".
  notSeenAfterMs: 30 * DAY_MS,
  maxRenames: 10,
});

const ID_PATTERN = /^(fleet|browser|screen):[A-Za-z0-9._-]{1,96}$/;

export class ScreenRegistryError extends DomainInvariantError {
  constructor(message, { code, details } = {}) {
    super(message, { code, details });
    this.name = 'ScreenRegistryError';
  }
}

/** The name a browser gets when nobody named it ("Browser 1a2b3c4d"). */
export function isPlaceholderBrowserName(name) {
  return typeof name === 'string' && /^Browser [0-9a-zA-Z-]{1,8}$/.test(name.trim());
}

function latest(...times) {
  const valid = times.filter((t) => Number.isFinite(Date.parse(t)));
  return valid.length ? valid.sort((a, b) => Date.parse(b) - Date.parse(a))[0] : null;
}

export function emptyRegistry() {
  return { screens: {}, aliases: {} };
}

/** @returns {string|null} trimmed, single-spaced, bounded; null when empty */
export function normalizeScreenName(raw) {
  if (typeof raw !== 'string') return null;
  const value = raw.replace(/\s+/g, ' ').trim().slice(0, SCREEN_DEFAULTS.maxNameLength).trim();
  return value || null;
}

function normalizeRoom(raw) {
  return normalizeScreenName(raw);
}

const nameKey = (name) => String(name).toLocaleLowerCase();

export function isScreenId(id) {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

/** 'screen' (configured), 'browser', or 'added'. */
export function screenKind(id) {
  if (id.startsWith('fleet:')) return 'screen';
  if (id.startsWith('browser:')) return 'browser';
  return 'added';
}

function clone(state) {
  const base = state || emptyRegistry();
  return {
    screens: Object.fromEntries(Object.entries(base.screens || {}).map(([id, s]) => [id, { ...s, renames: [...(s.renames || [])] }])),
    aliases: Object.fromEntries(Object.entries(base.aliases || {}).map(([id, a]) => [id, structuredClone(a)])),
    ...(base.adjacency ? { adjacency: Object.fromEntries(Object.entries(base.adjacency).map(([room, list]) => [room, [...list]])) } : {}),
  };
}

function configuredById(configured) {
  return new Map((configured || []).map((device) => [device.id, device]));
}

/** Follow a merged duplicate to the screen it was folded into. */
export function resolveScreenId(state, id) {
  return state?.aliases?.[id]?.into ?? id;
}

/** The screen's own id followed by every duplicate merged into it. */
export function aliasesOf(state, id) {
  const target = resolveScreenId(state, id);
  const merged = Object.entries(state?.aliases || {})
    .filter(([, alias]) => alias?.into === target)
    .map(([alias]) => alias);
  return [target, ...merged];
}

function effectiveName(id, entry, device) {
  return entry?.name || device?.name || null;
}

/** Names held by live (not retired) screens, keyed lower-case → id. */
function takenNames(state, configured, exceptId) {
  const taken = new Map();
  const devices = configuredById(configured);
  for (const [id, device] of devices) {
    const entry = state.screens[id];
    if (entry?.retiredAt || id === exceptId) continue;
    const name = effectiveName(id, entry, device);
    if (name) taken.set(nameKey(name), id);
  }
  for (const [id, entry] of Object.entries(state.screens)) {
    if (devices.has(id) || entry?.retiredAt || id === exceptId) continue;
    if (entry?.name) taken.set(nameKey(entry.name), id);
  }
  return taken;
}

function numberedSuggestion(name, taken) {
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${name} (${n})`;
    if (!taken.has(nameKey(candidate))) return candidate;
  }
  return null;
}

function browserSuffixed(name, id, taken) {
  const prefix = id.slice(id.indexOf(':') + 1).slice(0, 8);
  let candidate = `${name} (${prefix})`;
  for (let n = 2; taken.has(nameKey(candidate)); n += 1) candidate = `${name} (${prefix}-${n})`;
  return candidate;
}

function requireId(id) {
  if (!isScreenId(id)) throw new ScreenRegistryError(`Not a screen id: ${id}`, { code: 'INVALID_SCREEN_ID', details: { id } });
}

/**
 * The entry a write may touch: configured screens and browsers can be created
 * on first write; an added (`screen:`) id must already exist.
 */
function writableEntry(state, id, { configured, at, create = true } = {}) {
  requireId(id);
  const devices = configuredById(configured);
  if (id.startsWith('fleet:') && configured && !devices.has(id)) {
    throw new ScreenRegistryError(`Unknown screen: ${id}`, { code: 'SCREEN_NOT_FOUND', details: { id } });
  }
  if (state.aliases[id]) {
    throw new ScreenRegistryError(`${id} was merged into ${state.aliases[id].into}`, { code: 'SCREEN_MERGED', details: { id, into: state.aliases[id].into } });
  }
  if (state.screens[id]) return state.screens[id];
  if (!create || id.startsWith('screen:')) {
    throw new ScreenRegistryError(`Unknown screen: ${id}`, { code: 'SCREEN_NOT_FOUND', details: { id } });
  }
  const entry = {
    name: null,
    room: null,
    firstSeen: at ?? null,
    lastSeen: id.startsWith('browser:') ? (at ?? null) : null,
    renames: [],
    retiredAt: null,
    source: id.startsWith('fleet:') ? 'configured' : 'seen',
  };
  state.screens[id] = entry;
  return entry;
}

function viewOne(id, entry, device, now, signal) {
  const renames = entry?.renames || [];
  const windowStart = now - SCREEN_DEFAULTS.wasNameWindowMs;
  const recent = renames.filter((r) => Date.parse(r.at) >= windowStart);
  const name = effectiveName(id, entry, device) ?? `Screen ${id.slice(id.indexOf(':') + 1, id.indexOf(':') + 9)}`;
  const wasName = recent.length && nameKey(recent[0].from || '') !== nameKey(name) ? recent[0].from : null;
  const seen = [entry?.lastSeen, signal?.lastSeen].filter((t) => Number.isFinite(Date.parse(t)));
  const lastSeen = seen.length ? seen.sort((a, b) => Date.parse(b) - Date.parse(a))[0] : null;
  return {
    id,
    kind: screenKind(id),
    screenId: id.startsWith('fleet:') ? id.slice(6) : null,
    name,
    configuredName: device?.name ?? null,
    wasName: wasName || null,
    renamedAt: renames.length ? renames[renames.length - 1].at : null,
    room: entry?.room || device?.room || null,
    type: device?.type ?? (id.startsWith('browser:') ? 'browser' : null),
    configured: Boolean(device),
    wakeable: Boolean(device?.wakeable),
    source: device ? 'configured' : (entry?.source || 'seen'),
    firstSeen: entry?.firstSeen ?? null,
    lastSeen,
    online: typeof signal?.online === 'boolean' ? signal.online : null,
    retiredAt: entry?.retiredAt ?? null,
    lastPlayed: latest(entry?.playedAt, signal?.lastPlayed),
    aliases: [],
    aliasNames: {},
  };
}

/**
 * The household's screen list.
 * @param {{configured: Array<{id,screenId,name,room,type}>, state: Object, now: number,
 *          signals?: Object<string,{lastSeen?:string, online?:boolean}>}} input
 * @returns {{screens: Object[], notSeenLately: Object[], retired: Object[], unnamed: Object[]}}
 *   `unnamed`: browsers nobody named that never played — every private window
 *   or test browser that merely opened the app; kept out of the main list.
 */
export function buildScreenView({ configured = [], state, now, signals = {} }) {
  const registry = state || emptyRegistry();
  const devices = configuredById(configured);
  const ids = new Set([...devices.keys(), ...Object.keys(registry.screens || {})]);
  const views = new Map();
  for (const id of ids) {
    if (registry.aliases?.[id]) continue;
    views.set(id, viewOne(id, registry.screens?.[id], devices.get(id), now, signals[id]));
  }
  for (const [alias, { into, was }] of Object.entries(registry.aliases || {})) {
    const view = views.get(into);
    if (!view) continue;
    view.aliases.push(alias);
    if (was?.name) view.aliasNames[alias] = was.name;
    const aliasPlayed = latest(view.lastPlayed, was?.playedAt, signals[alias]?.lastPlayed);
    if (aliasPlayed) view.lastPlayed = aliasPlayed;
    const signal = signals[alias];
    if (signal?.lastSeen && (!view.lastSeen || Date.parse(signal.lastSeen) > Date.parse(view.lastSeen))) view.lastSeen = signal.lastSeen;
    if (signal?.online === true) view.online = true;
  }
  const byName = (a, b) => a.name.localeCompare(b.name);
  const out = { screens: [], notSeenLately: [], retired: [], unnamed: [] };
  for (const view of views.values()) {
    if (view.retiredAt) { out.retired.push(view); continue; }
    if (view.kind === 'browser' && isPlaceholderBrowserName(view.name) && !view.lastPlayed && !view.aliases.length) {
      out.unnamed.push(view);
      continue;
    }
    const quiet = view.lastSeen && now - Date.parse(view.lastSeen) > SCREEN_DEFAULTS.notSeenAfterMs;
    (quiet && view.online !== true ? out.notSeenLately : out.screens).push(view);
  }
  out.screens.sort(byName);
  out.notSeenLately.sort(byName);
  out.retired.sort(byName);
  out.unnamed.sort(byName);
  return out;
}

/** `now` for a view returned by a write: the write's own timestamp. */
const nowOf = (at) => (Number.isFinite(Date.parse(at)) ? Date.parse(at) : 0);

function findView(state, id, configured, now) {
  const view = buildScreenView({ configured, state, now });
  return [...view.screens, ...view.notSeenLately, ...view.retired, ...view.unnamed].find((s) => s.id === id) || null;
}

/**
 * A browser (or kiosk) reporting in. Registers an unknown browser under the
 * name it carries (suffixed with its id prefix if taken); an existing screen
 * keeps its registry name and only refreshes lastSeen. A merged duplicate
 * refreshes the screen it was merged into.
 * @returns {{state, id, screen, created:boolean}}
 */
export function touchScreen(state, rawId, { name = null, room = null, at, playing = false } = {}, { configured = [] } = {}) {
  requireId(rawId);
  const next = clone(state);
  const id = resolveScreenId(next, rawId);
  const devices = configuredById(configured);
  const existed = Boolean(next.screens[id]) || devices.has(id);
  if (id.startsWith('screen:') && !next.screens[id]) {
    throw new ScreenRegistryError(`Unknown screen: ${id}`, { code: 'SCREEN_NOT_FOUND', details: { id } });
  }
  if (id.startsWith('fleet:') && !devices.has(id)) {
    throw new ScreenRegistryError(`Unknown screen: ${id}`, { code: 'SCREEN_NOT_FOUND', details: { id } });
  }
  const entry = writableEntry(next, id, { configured, at });
  entry.lastSeen = at ?? entry.lastSeen;
  if (!entry.firstSeen) entry.firstSeen = at ?? null;
  if (playing && at) entry.playedAt = at;
  if (id.startsWith('browser:') && !entry.name) {
    const wanted = normalizeScreenName(name) || `Browser ${id.slice(8, 16)}`;
    const taken = takenNames(next, configured, id);
    entry.name = taken.has(nameKey(wanted)) ? browserSuffixed(wanted, id, taken) : wanted;
    if (!entry.room) entry.room = normalizeRoom(room);
  }
  return { state: next, id, screen: findView(next, id, configured, nowOf(at)), created: !existed };
}

/**
 * Rename a screen. A name another live screen holds is refused (NAME_TAKEN,
 * with a free `suggestion`) unless `onCollision: 'suffix'`, which takes the
 * suggestion. The change is recorded in `renames` for the "(was …)" label.
 */
export function renameScreen(state, id, rawName, { at, configured = [], onCollision = 'reject' } = {}) {
  requireId(id);
  const name = normalizeScreenName(rawName);
  if (!name) throw new ScreenRegistryError('A screen needs a name', { code: 'INVALID_NAME' });
  const next = clone(state);
  const taken = takenNames(next, configured, id);
  let finalName = name;
  if (taken.has(nameKey(name))) {
    const suggestion = numberedSuggestion(name, taken);
    if (onCollision !== 'suffix') {
      throw new ScreenRegistryError(`"${name}" is already the name of another screen`, {
        code: 'NAME_TAKEN', details: { name, heldBy: taken.get(nameKey(name)), suggestion },
      });
    }
    finalName = suggestion;
  }
  const device = configuredById(configured).get(id);
  const entry = writableEntry(next, id, { configured, at });
  const before = effectiveName(id, entry, device);
  if (before !== finalName) {
    entry.renames = [...(entry.renames || []), { from: before, to: finalName, at }].slice(-SCREEN_DEFAULTS.maxRenames);
    entry.name = device && finalName === device.name ? null : finalName;
  }
  return { state: next, screen: findView(next, id, configured, nowOf(at)), previousName: before };
}

/** Set (or with null clear) a screen's room. */
export function setScreenRoom(state, id, rawRoom, { configured = [], at = null } = {}) {
  const next = clone(state);
  const entry = writableEntry(next, id, { configured, at });
  entry.room = normalizeRoom(rawRoom);
  return { state: next, screen: findView(next, id, configured, nowOf(at)) };
}

const roomKey = (room) => String(room).toLocaleLowerCase();

/**
 * Which rooms neighbour which (PLACE.4a/AC6, RQ-PLACE-10), as the registry
 * stores it: `adjacency: { <room name>: [<neighbouring room names>] }`. Read
 * symmetrically (A lists B, or B lists A, means they neighbour), so the view
 * is `{ <room>: [neighbours sorted] }` with every link present on both sides.
 * Rooms are matched case-insensitively and a room is never its own neighbour.
 */
export function roomAdjacencyView(state) {
  const names = new Map(); // key -> display name
  const links = new Map(); // key -> Set(key)
  const note = (room) => { const k = roomKey(room); if (!names.has(k)) names.set(k, room); if (!links.has(k)) links.set(k, new Set()); return k; };
  for (const [room, list] of Object.entries(state?.adjacency || {})) {
    const a = normalizeRoom(room);
    if (!a) continue;
    const ka = note(a);
    for (const other of Array.isArray(list) ? list : []) {
      const b = normalizeRoom(other);
      if (!b || roomKey(b) === ka) continue;
      const kb = note(b);
      links.get(ka).add(kb);
      links.get(kb).add(ka);
    }
  }
  const out = {};
  for (const [k, set] of [...links].sort((x, y) => names.get(x[0]).localeCompare(names.get(y[0])))) {
    if (!set.size) continue;
    out[names.get(k)] = [...set].map((n) => names.get(n)).sort((x, y) => x.localeCompare(y));
  }
  return out;
}

/** Replace the neighbours of `room` (an empty list clears them). The link is mutual. */
export function setRoomNeighbours(state, rawRoom, rawNeighbours) {
  const room = normalizeRoom(rawRoom);
  if (!room) throw new ScreenRegistryError('A room needs a name', { code: 'INVALID_ROOM' });
  if (!Array.isArray(rawNeighbours)) throw new ScreenRegistryError('neighbours must be a list of room names', { code: 'INVALID_ROOM' });
  const key = roomKey(room);
  const wanted = new Map();
  for (const raw of rawNeighbours) {
    const name = normalizeRoom(raw);
    if (name && roomKey(name) !== key) wanted.set(roomKey(name), name);
  }
  // Start from the symmetric view, drop every link to this room, then add the new ones.
  const view = roomAdjacencyView(state);
  const next = clone(state);
  const adjacency = {};
  for (const [r, list] of Object.entries(view)) {
    if (roomKey(r) === key) continue;
    const kept = list.filter((n) => roomKey(n) !== key);
    if (kept.length) adjacency[r] = kept;
  }
  if (wanted.size) {
    adjacency[room] = [...wanted.values()];
  }
  next.adjacency = adjacency;
  return { state: next, adjacency: roomAdjacencyView(next) };
}

function slugOf(name) {
  return name.toLocaleLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'screen';
}

/** Add a screen by hand (RQ-HOUSE-08): a name (unique) and an optional room. */
export function addScreen(state, { name: rawName, room = null, at } = {}, { configured = [] } = {}) {
  const name = normalizeScreenName(rawName);
  if (!name) throw new ScreenRegistryError('A screen needs a name', { code: 'INVALID_NAME' });
  const next = clone(state);
  const taken = takenNames(next, configured, null);
  if (taken.has(nameKey(name))) {
    throw new ScreenRegistryError(`"${name}" is already the name of another screen`, {
      code: 'NAME_TAKEN', details: { name, heldBy: taken.get(nameKey(name)), suggestion: numberedSuggestion(name, taken) },
    });
  }
  const base = `screen:${slugOf(name)}`;
  let id = base;
  for (let n = 2; next.screens[id] || next.aliases[id]; n += 1) id = `${base}-${n}`;
  next.screens[id] = {
    name, room: normalizeRoom(room), firstSeen: at ?? null, lastSeen: null, renames: [], retiredAt: null, source: 'added',
  };
  return { state: next, id, screen: findView(next, id, configured, nowOf(at)) };
}

/**
 * Fold a duplicate into its earlier self (RQ-HOUSE-08). The duplicate's id
 * becomes an alias: its plays and spots count for the target from now on.
 * The folded entry is kept on the alias (`was`) and duplicates that came
 * along through it remember the hop (`via`), so unmergeScreen can undo it.
 * A configured screen cannot be merged away (devices.yml owns it).
 */
export function mergeScreens(state, fromId, intoId, { at, configured = [] } = {}) {
  requireId(fromId);
  requireId(intoId);
  const next = clone(state);
  const into = resolveScreenId(next, intoId);
  const devices = configuredById(configured);
  if (fromId === into || resolveScreenId(next, fromId) === into) {
    throw new ScreenRegistryError('A screen cannot be merged into itself', { code: 'INVALID_MERGE', details: { fromId, intoId } });
  }
  if (fromId.startsWith('fleet:')) {
    throw new ScreenRegistryError('A configured screen cannot be merged away; merge the duplicate into it', { code: 'INVALID_MERGE', details: { fromId } });
  }
  const from = next.screens[fromId];
  if (!from) throw new ScreenRegistryError(`Unknown screen: ${fromId}`, { code: 'SCREEN_NOT_FOUND', details: { id: fromId } });
  if (!next.screens[into] && !devices.has(into)) {
    throw new ScreenRegistryError(`Unknown screen: ${into}`, { code: 'SCREEN_NOT_FOUND', details: { id: into } });
  }
  const target = writableEntry(next, into, { configured: devices.size ? configured : null, at });
  if (target.retiredAt) {
    throw new ScreenRegistryError(`${into} is retired`, { code: 'INVALID_MERGE', details: { intoId: into } });
  }
  const times = (a, b, pick) => {
    const valid = [a, b].filter((t) => Number.isFinite(Date.parse(t)));
    if (!valid.length) return null;
    return valid.sort((x, y) => Date.parse(x) - Date.parse(y))[pick === 'min' ? 0 : valid.length - 1];
  };
  target.firstSeen = times(target.firstSeen, from.firstSeen, 'min');
  target.lastSeen = times(target.lastSeen, from.lastSeen, 'max');
  if (!target.room && from.room) target.room = from.room;
  delete next.screens[fromId];
  // The folded entry rides on the alias so the merge can be undone.
  next.aliases[fromId] = { into, mergedAt: at ?? null, was: structuredClone(from) };
  for (const alias of Object.values(next.aliases)) {
    if (alias.into === fromId) {
      alias.into = into;
      alias.via = [...(alias.via || []), fromId];
    }
  }
  return { state: next, into, screen: findView(next, into, configured, nowOf(at)) };
}

/** Retire a screen: it leaves the list and its name is free again. */
export function retireScreen(state, id, { at, configured = [] } = {}) {
  const next = clone(state);
  const entry = writableEntry(next, id, { configured, at });
  entry.retiredAt = at ?? new Date(0).toISOString();
  return { state: next, screen: findView(next, id, configured, nowOf(at)) };
}

/** Undo a retirement. Refused when its name was taken in the meantime. */
export function restoreScreen(state, id, { configured = [], at = null } = {}) {
  const next = clone(state);
  const entry = writableEntry(next, id, { configured, create: false });
  const device = configuredById(configured).get(id);
  const name = effectiveName(id, entry, device);
  if (name && takenNames(next, configured, id).has(nameKey(name))) {
    throw new ScreenRegistryError(`"${name}" is now the name of another screen; rename one first`, {
      code: 'NAME_TAKEN', details: { name },
    });
  }
  entry.retiredAt = null;
  return { state: next, screen: findView(next, id, configured, nowOf(at)) };
}

/**
 * Undo a merge: the alias becomes its own screen again, with the entry it had
 * when it was folded (its name suffixed if another screen took it since), and
 * duplicates that came along through it point back at it.
 * @returns {{state, into:string, screen:Object, was:Object}}
 */
export function unmergeScreen(state, id, { at, configured = [] } = {}) {
  requireId(id);
  const next = clone(state);
  const alias = next.aliases[id];
  if (!alias?.was) {
    throw new ScreenRegistryError(`${id} is not a merged screen`, { code: 'NOT_MERGED', details: { id } });
  }
  const { into, was } = alias;
  delete next.aliases[id];
  const restored = { ...was, renames: [...(was.renames || [])] };
  delete restored.spotFolds;
  if (restored.name) {
    const taken = takenNames(next, configured, id);
    if (taken.has(nameKey(restored.name))) restored.name = numberedSuggestion(restored.name, taken);
  }
  next.screens[id] = restored;
  for (const other of Object.values(next.aliases)) {
    if (other.via?.[other.via.length - 1] === id) {
      other.into = id;
      other.via = other.via.slice(0, -1);
      if (!other.via.length) delete other.via;
    }
  }
  return { state: next, into, was, screen: findView(next, id, configured, nowOf(at)) };
}

/** Record which progress records a merge folded spots in (for unmerge). */
export function recordSpotFolds(state, id, folds) {
  const next = clone(state);
  if (next.aliases[id]?.was) next.aliases[id].was.spotFolds = folds;
  return next;
}
