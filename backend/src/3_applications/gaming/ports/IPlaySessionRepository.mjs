/**
 * Persistence for play sessions.
 *
 * Sessions must survive a backend restart mid-play: a restart that forgot
 * `playedMs` would either hand out free time or bill it twice. Implementations
 * return domain entities, never storage shapes.
 */
export class IPlaySessionRepository {
  async save(_session) { throw new Error('IPlaySessionRepository.save must be implemented'); }
  async findById(_sessionId) { throw new Error('IPlaySessionRepository.findById must be implemented'); }
  /** The one session currently open on a device, or null. */
  async findOpenForDevice(_deviceId) { throw new Error('IPlaySessionRepository.findOpenForDevice must be implemented'); }
  /** Sessions on a device that started at or after an instant — the set that
   *  reconciliation compares against what the device itself recorded. */
  async listForDeviceSince(_deviceId, _sinceIso) { throw new Error('IPlaySessionRepository.listForDeviceSince must be implemented'); }
}
