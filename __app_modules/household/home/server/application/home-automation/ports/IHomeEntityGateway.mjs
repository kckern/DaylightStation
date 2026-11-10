/**
 * IHomeEntityGateway
 *
 * Port for reading every entity the home platform knows about, with the rooms
 * it has and which entity sits in which room. Implementations translate the
 * platform's vocabulary into the shapes below; nothing provider-specific
 * (attribute key names, template syntax) crosses this port.
 *
 * @typedef {Object} EntityReading
 * @property {string} entityId - "domain.object_id"
 * @property {string|null} state
 * @property {string|null} name - the platform's display name
 * @property {string|null} deviceClass - what the entity measures or represents
 * @property {string|null} unit - unit of a numeric reading
 * @property {string|null} lastChanged - ISO timestamp
 * @property {ReadingDetail} detail
 *
 * @typedef {Object} ReadingDetail
 * @property {number} [brightnessPct] - 0-100, lights
 * @property {number} [currentTemperature] - climate
 * @property {number} [targetTemperature] - climate
 * @property {string} [hvacAction] - climate: heating, cooling, idle…
 * @property {string} [mediaTitle] - media players
 * @property {number} [speedPct] - fans, 0-100
 *
 * listReadings(): Promise<EntityReading[]>
 *   Current state of every entity. An unreachable platform throws — never an
 *   empty list, which would read as a house with nothing in it.
 *
 * listRooms(): Promise<{rooms: Array<{id, name}>, assignments: Object.<string, string>}>
 *   Room data is decoration: an implementation that cannot supply it returns
 *   empty collections rather than failing the read.
 */

export function isHomeEntityGateway(obj) {
  return Boolean(obj) && typeof obj.listReadings === 'function' && typeof obj.listRooms === 'function';
}

export class IHomeEntityGateway {
  async listReadings() { throw new Error('IHomeEntityGateway.listReadings not implemented'); }
  async listRooms() { throw new Error('IHomeEntityGateway.listRooms not implemented'); }
}

export default IHomeEntityGateway;
