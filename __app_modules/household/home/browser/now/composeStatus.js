/**
 * The Now view's content, composed from the server's house summary and the
 * entity list: one status sentence, and the sections that are not empty.
 * Pure: the server decided what counts (policy); this decides how to say it.
 */

import { displayName, formatWatts, openingWord } from '../entities/formatEntityState.js';

// A figure stays on the same line as its noun ("4 lights", "1.6 kW").
const NBSP = '\u00a0';

const ROOMLESS = Object.freeze({ id: '__none__', name: 'Elsewhere' });

/** "the office" — a room name as it sits inside a sentence. */
export function inSentence(roomName) {
  return `the ${roomName.toLowerCase()}`;
}

/** "a", "b and c", "a, b and c" — a short list said aloud. */
export function listWords(words) {
  if (words.length <= 1) return words.join('');
  if (words.length === 2) return `${words[0]} and ${words[1]}`;
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

function plural(n, one, many = `${one}s`) {
  return `${n}${NBSP}${n === 1 ? one : many}`;
}

/** Group entities by room, in the house's room order, roomless last. */
export function groupByRoom(entities, rooms) {
  const order = [...rooms.map((r) => ({ id: r.id, name: r.name })), ROOMLESS];
  const buckets = new Map(order.map((r) => [r.id, []]));
  for (const e of entities) {
    const key = e.room?.id && buckets.has(e.room.id) ? e.room.id : ROOMLESS.id;
    buckets.get(key).push(e);
  }
  return order.map((r) => ({ ...r, entities: buckets.get(r.id) })).filter((r) => r.entities.length);
}

/**
 * The sentence. Numbers stay digits (they are live figures, and the page's
 * other figures are digits too); rooms are lowercased into the prose.
 *
 * @returns {string[]} sentences, each ending in a full stop
 */
export function composeSentence({ watts, lightsOn, open, motionRooms }) {
  const sentences = [];
  const parts = [];
  if (lightsOn > 0 || open.length > 0 || watts != null) {
    parts.push(lightsOn > 0 ? `${plural(lightsOn, 'light')} on` : 'no lights on');
  }
  if (open.length === 1) {
    const [o] = open;
    parts.push(o.room ? `a ${openingWord(o)} open in ${inSentence(o.room.name)}` : `a ${openingWord(o)} open`);
  } else if (open.length > 1) {
    const words = new Set(open.map(openingWord));
    parts.push(words.size === 1 ? `${plural(open.length, [...words][0])} open` : `${open.length} doors and windows open`);
  }

  if (watts != null) {
    const quiet = lightsOn === 0 && open.length === 0;
    sentences.push(quiet
      ? `The house is quiet, drawing ${formatWatts(watts).replace(' ', NBSP)} with nothing on.`
      : `The house is drawing ${formatWatts(watts).replace(' ', NBSP)}, with ${listWords(parts)}.`);
  } else if (parts.length) {
    const [first, ...rest] = parts;
    const lead = first.charAt(0).toUpperCase() + first.slice(1);
    sentences.push(rest.length ? `${lead}, ${listWords(rest)}.` : `${lead}.`);
  } else {
    sentences.push('All quiet. Nothing is on.');
  }

  if (motionRooms.length === 1) {
    sentences.push(`Someone is in ${inSentence(motionRooms[0])}.`);
  } else if (motionRooms.length === 2) {
    sentences.push(`Someone is in ${inSentence(motionRooms[0])} and ${inSentence(motionRooms[1])}.`);
  } else if (motionRooms.length > 2) {
    const others = motionRooms.length - 2;
    sentences.push(`Someone is in ${inSentence(motionRooms[0])}, ${inSentence(motionRooms[1])} and ${plural(others, 'other room')}.`);
  }
  return sentences;
}

const isTempSensor = (e) => e.domain === 'sensor' && e.deviceClass === 'temperature' && e.stateClass === 'reading';
const isHumiditySensor = (e) => e.domain === 'sensor' && e.deviceClass === 'humidity' && e.stateClass === 'reading';
// A bulb's die temperature or a switch's internals are not the room.
const isDeviceInternal = (e) => /device_temperature|internal|_outdoor_/.test(e.id);

/** The one temperature a room is said to have: a thermostat's, else its first room sensor's. */
export function roomTemperature(roomEntities) {
  const thermostat = roomEntities.find((e) => e.domain === 'climate' && Number.isFinite(e.detail?.currentTemperature));
  if (thermostat) return { value: thermostat.detail.currentTemperature, entityId: thermostat.id, thermostat };
  const sensor = roomEntities.filter(isTempSensor).sort((a, b) => Number(isDeviceInternal(a)) - Number(isDeviceInternal(b)))[0];
  if (!sensor || isDeviceInternal(sensor)) return null;
  return { value: Number(sensor.state), entityId: sensor.id, thermostat: null };
}

export function roomHumidity(roomEntities) {
  const sensor = roomEntities.find(isHumiditySensor);
  return sensor ? Number(sensor.state) : null;
}

/** Latest presence activity in a room: now, or when it was last seen. */
export function roomMotion(roomEntities) {
  const presence = roomEntities.filter((e) => e.type === 'presence' && e.stateClass !== 'unavailable');
  if (!presence.length) return null;
  if (presence.some((e) => e.stateClass === 'on')) return { now: true, at: null };
  const latest = presence.map((e) => Date.parse(e.lastChanged)).filter(Number.isFinite).sort((a, b) => b - a)[0];
  return Number.isFinite(latest) ? { now: false, at: new Date(latest).toISOString() } : null;
}

/** "plugs" when everything else that is on is a plug; "devices" otherwise. */
export function othersWord(others) {
  if (!others.length) return 'devices';
  return others.every((e) => e.type === 'power') ? 'plugs' : 'devices';
}

/**
 * @param {{entities: Array, rooms: Array, summary: Object|null}} payload
 * @returns {{sentences: string[], on: {lights: Array, others: Array}, open: Array, motion: Array,
 *   attention: {lowBattery: Array, unavailable: Array}, climate: Array, counts: Object}}
 */
export function composeNow({ entities, rooms, summary }) {
  const byId = new Map(entities.map((e) => [e.id, e]));
  const pick = (ids) => ids.map((id) => byId.get(id)).filter(Boolean);
  const s = summary || { power: { wholeHouse: null }, on: [], open: [], motion: [], lowBattery: [], unavailable: [] };

  const on = pick(s.on);
  const lights = on.filter((e) => e.type === 'light');
  const others = on.filter((e) => e.type !== 'light');
  const open = pick(s.open);
  const motion = pick(s.motion);
  // Rooms with someone in them now come first, then the most recently seen.
  const motionByRoom = groupByRoom(motion, rooms).map((room) => ({ ...room, motion: roomMotion(room.entities) }))
    .sort((a, b) => Number(Boolean(b.motion?.now)) - Number(Boolean(a.motion?.now))
      || (Date.parse(b.motion?.at) || 0) - (Date.parse(a.motion?.at) || 0));
  const motionRooms = motionByRoom.filter((r) => r.id !== ROOMLESS.id).map((r) => r.name);
  const lowBattery = s.lowBattery.map((b) => ({ ...byId.get(b.entityId), pct: b.pct })).filter((e) => e.id);
  const unavailable = pick(s.unavailable);

  const climate = groupByRoom(entities.filter((e) => e.room && e.type === 'climate'), rooms)
    .map((room) => {
      const temperature = roomTemperature(room.entities);
      if (!temperature) return null;
      return { id: room.id, name: room.name, temperature, humidity: roomHumidity(room.entities) };
    })
    .filter(Boolean);
  const outdoor = entities.find((e) => isTempSensor(e) && /_outdoor_/.test(e.id)) || null;

  return {
    sentences: composeSentence({ watts: s.power.wholeHouse?.watts ?? null, lightsOn: lights.length, open, motionRooms }),
    on: { lights: groupByRoom(lights, rooms), others },
    open: open.map((e) => ({ ...e, label: displayName(e) })),
    motion: motionByRoom,
    attention: { lowBattery, unavailable },
    climate,
    outdoor: outdoor ? Number(outdoor.state) : null,
    counts: {
      lightsOn: lights.length, othersOn: others.length, othersWord: othersWord(others),
      open: open.length, motionRooms: motionRooms.length,
      lowBattery: lowBattery.length, unavailable: unavailable.length,
    },
  };
}
