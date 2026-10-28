/**
 * IHomeEntityCatalog
 *
 * Port for reading every entity the home platform knows about, with the rooms
 * it has and which entity sits in which room.
 *
 * listReadings(): Promise<Array<{entityId, state, attributes, lastChanged}>>
 *   Current state of every entity. An unreachable platform throws — never an
 *   empty list, which would read as a house with nothing in it.
 *
 * listRooms(): Promise<{rooms: Array<{id, name}>, assignments: Object.<string, string>}>
 *   Room data is decoration: an implementation that cannot supply it returns
 *   empty collections rather than failing the read.
 */

export function isHomeEntityCatalog(obj) {
  return Boolean(obj) && typeof obj.listReadings === 'function' && typeof obj.listRooms === 'function';
}

export class IHomeEntityCatalog {
  async listReadings() { throw new Error('IHomeEntityCatalog.listReadings not implemented'); }
  async listRooms() { throw new Error('IHomeEntityCatalog.listRooms not implemented'); }
}

export default IHomeEntityCatalog;
