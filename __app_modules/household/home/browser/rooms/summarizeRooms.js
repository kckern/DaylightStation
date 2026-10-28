/**
 * One line per room, and what opens under it. Pure presentation: the server
 * has already typed, roomed and state-classed every entity.
 */

import { groupByRoom, roomHumidity, roomMotion, roomTemperature } from '../now/composeStatus.js';

// What a person sees as a device in a room — a plug, a door, a TV, a fan — as
// opposed to a reading about it or an automation's flag (the catch-all
// "switch" type: input_booleans and unnamed switches), which wait behind
// "Show all".
const DEVICE_TYPES = new Set(['light', 'power', 'openings', 'media', 'climate']);
const isDevice = (e) => DEVICE_TYPES.has(e.type) && e.domain !== 'sensor';
const isLight = (e) => e.type === 'light';

/**
 * @param {Array} entities - entity JSON from /home-dashboard/entities
 * @param {Array} rooms - [{id, name}] in display order
 * @returns {Array<{id, name, lightsOn: number, lights: Array, devices: Array, more: Array,
 *   temperature: Object|null, humidity: number|null, motion: Object|null, unavailable: number}>}
 */
export function summarizeRooms(entities, rooms) {
  return groupByRoom(entities, rooms).map((room) => {
    const lights = room.entities.filter(isLight);
    const devices = room.entities.filter((e) => !isLight(e) && isDevice(e));
    const more = room.entities.filter((e) => !isLight(e) && !isDevice(e));
    const byActivity = (a, b) => Number(b.stateClass === 'on') - Number(a.stateClass === 'on') || a.name.localeCompare(b.name);
    return {
      id: room.id,
      name: room.name,
      lights: lights.slice().sort(byActivity),
      lightsOn: lights.filter((e) => e.stateClass === 'on').length,
      devices: devices.slice().sort(byActivity),
      devicesOn: devices.filter((e) => e.stateClass === 'on').length,
      more: more.slice().sort((a, b) => a.name.localeCompare(b.name)),
      temperature: roomTemperature(room.entities),
      humidity: roomHumidity(room.entities),
      motion: roomMotion(room.entities),
      unavailable: room.entities.filter((e) => e.stateClass === 'unavailable').length,
      total: room.entities.length,
    };
  });
}

/**
 * @param {Array} entities
 * @param {string} roomId - a room id, or '__none__'
 * @returns {Array} the controllable lights in that room that are on
 */
export function litLightsIn(entities, roomId) {
  return entities.filter((e) => e.type === 'light' && e.stateClass === 'on' && e.controllable
    && (e.room?.id || '__none__') === roomId);
}
