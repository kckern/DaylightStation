// frontend/src/modules/Media/household/householdModel.js
// Pure presentation rules for the household's shared media memory (tech doc
// §2.4–2.9): screen names, "where they stopped", per-screen spots and the
// play plan they imply (RQ-PLAY-08/09), and the mapping from a household
// entry / suggestion to the item shape every verb already understands.
// No React, no fetch.
import { deviceName } from '../fleet/deviceDisplay.js';

/** `fleet:livingroom-tv` → `livingroom-tv` (the fleet/peek device key). */
export function bareScreenId(id) {
  if (typeof id !== 'string') return id ?? null;
  return id.startsWith('fleet:') ? id.slice('fleet:'.length) : id;
}

/**
 * A name lookup over `GET /api/v1/media/screens`. Accepts screen ids, bare
 * devices.yml keys and merged duplicates (aliases). A raw id never reaches
 * the UI: this device is "this device", an unregistered browser "another
 * browser", an unknown fleet key is humanized.
 */
export function createScreenNamer(screensResponse, { selfId = null } = {}) {
  const byId = new Map();
  const lists = [screensResponse?.screens, screensResponse?.notSeenLately, screensResponse?.retired];
  for (const list of lists) {
    for (const screen of Array.isArray(list) ? list : []) {
      if (!screen?.id || !screen.name) continue;
      byId.set(screen.id, screen.name);
      if (screen.screenId) byId.set(screen.screenId, screen.name);
      for (const alias of Array.isArray(screen.aliases) ? screen.aliases : []) byId.set(alias, screen.name);
    }
  }
  return function nameFor(id) {
    if (typeof id !== 'string' || !id) return null;
    // The shared playhead kept from before per-screen spots existed.
    if (id === 'legacy') return EARLIER;
    if (selfId && id === selfId) return 'this device';
    if (byId.has(id)) return byId.get(id);
    if (id.startsWith('browser:') || id.startsWith('ephemeral:')) return 'another browser';
    const bare = id.replace(/^(fleet|screen):/, '');
    if (byId.has(bare)) return byId.get(bare);
    return deviceName(null, bare);
  };
}

/** What a spot with no screen (written before per-screen spots) is called. */
export const EARLIER = 'earlier';

/** "1 h 20 m on Living Room TV", or "12 m, saved earlier" for a spot with no screen. */
export function spotLine(spot, nameFor) {
  const at = formatDuration(spot?.playhead);
  const id = spot?.deviceId ?? null;
  const where = id && id !== 'legacy' && spot?.kind !== 'unknown' ? (nameFor?.(id) ?? null) : EARLIER;
  return !where || where === EARLIER ? `${at}, saved ${EARLIER}` : `${at} on ${where}`;
}

/** 4800 → "1 h 20 m"; 720 → "12 m". */
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return 'under a minute';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} m`;
  return m === 0 ? `${h} h` : `${h} h ${m} m`;
}

/** Where an unfinished item stopped, as time left: "34 min left". */
export function formatLeft(playhead, duration) {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const left = Math.max(0, duration - (Number.isFinite(playhead) ? playhead : 0));
  const minutes = Math.round(left / 60);
  if (minutes < 1) return 'almost done';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min left`;
  return m === 0 ? `${h} h left` : `${h} h ${m} min left`;
}

// Two spots this close are the same place for a person choosing.
const SAME_SPOT_SECONDS = 30;

function spotTime(spot) {
  const t = Date.parse(String(spot?.lastPlayed ?? '').replace(' ', 'T'));
  return Number.isFinite(t) ? t : 0;
}

/** Open spots that differ from each other, newest first. */
export function differingSpots(entry) {
  const open = (Array.isArray(entry?.spots) ? entry.spots : [])
    .filter(spot => spot && spot.open !== false && Number.isFinite(spot.playhead) && spot.playhead > 0)
    .sort((a, b) => spotTime(b) - spotTime(a));
  const out = [];
  for (const spot of open) {
    if (out.some(kept => Math.abs(kept.playhead - spot.playhead) < SAME_SPOT_SECONDS)) continue;
    out.push(spot);
  }
  return out;
}

/**
 * How a Play should start (PLAY.4a): continue from the one saved spot, ask
 * when screens hold different spots, start from the beginning when none.
 * An entry without per-screen spots (written before spots existed) falls
 * back to its shared playhead when it is still unfinished.
 */
export function resumePlan(entry) {
  if (!entry) return { kind: 'start' };
  const spots = differingSpots(entry);
  if (spots.length > 1) return { kind: 'choose', spots };
  if (spots.length === 1) return { kind: 'continue', spot: spots[0] };
  if (entry.finished !== true && Number.isFinite(entry.playhead) && entry.playhead > 0
    && Number.isFinite(entry.duration) && entry.playhead < entry.duration) {
    return { kind: 'continue', spot: { deviceId: null, playhead: entry.playhead, duration: entry.duration } };
  }
  return { kind: 'start' };
}

/** "1 h 20 m on Living Room TV · 12 m on Kid's tablet" — only when they differ. */
export function spotsSummary(entry, nameFor) {
  const spots = differingSpots(entry);
  if (spots.length < 2) return null;
  return spots.map(spot => spotLine(spot, nameFor)).join(' · ');
}

/** Household entry / suggestion / ledger row → the item every verb takes. */
export function toItem(entry) {
  if (!entry) return null;
  const id = entry.contentId ?? entry.id;
  if (!id) return null;
  const item = { id, title: entry.title ?? null, thumbnail: entry.thumbnail ?? null, type: entry.type ?? null };
  if (entry.kind === 'collection') item.itemType = 'container';
  else if (entry.kind === 'item') item.itemType = 'leaf';
  return item;
}

/** The screen an entry last played on, by name. */
export function whereLine(entry, nameFor) {
  const playedOn = entry?.playedOn;
  const id = typeof playedOn === 'string' ? playedOn : playedOn?.deviceId ?? entry?.plays?.[0]?.deviceId ?? null;
  return id ? (nameFor?.(id) ?? null) : null;
}

function parseWhen(value) {
  if (!value) return null;
  const text = String(value);
  // Progress-store local "YYYY-MM-DD HH:mm:ss" vs ledger ISO UTC.
  const t = Date.parse(/Z|[+-]\d\d:?\d\d$/.test(text) ? text : text.replace(' ', 'T'));
  return Number.isFinite(t) ? new Date(t) : null;
}

function clock(date) {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** "Today 9:05 AM", "Yesterday 9:30 PM", "Mon 7:02 PM", "Sep 28". */
export function playedAtLabel(value, now = new Date()) {
  const date = parseWhen(value);
  if (!date) return null;
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days <= 0) return `Today ${clock(date)}`;
  if (days === 1) return `Yesterday ${clock(date)}`;
  if (days < 7) return `${date.toLocaleDateString([], { weekday: 'short' })} ${clock(date)}`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** contentId → screen ids it is playing on right now (carry-on `nowOn`). */
export function nowOnScreenIds(nowOn) {
  const map = new Map();
  for (const entry of Array.isArray(nowOn) ? nowOn : []) {
    const id = entry?.contentId;
    if (!id || !entry.deviceId) continue;
    map.set(id, [...(map.get(id) ?? []), entry.deviceId]);
  }
  return map;
}
