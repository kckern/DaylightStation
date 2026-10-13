/**
 * Persistence for play sessions.
 *
 * Sessions must survive a backend restart mid-play: a restart that forgot
 * `playedMs` would either hand out free time or bill it twice. Implementations
 * return domain entities, never storage shapes.
 */
export class IArcadeGameSessionRepository {
  async save(_session) { throw new Error('IArcadeGameSessionRepository.save must be implemented'); }
  async findById(_sessionId) { throw new Error('IArcadeGameSessionRepository.findById must be implemented'); }
  /** The one session currently open on a device, or null. */
  async findOpenForDevice(_deviceId) { throw new Error('IArcadeGameSessionRepository.findOpenForDevice must be implemented'); }
  /** Every session currently open, across devices. */
  async listOpen() { throw new Error('IArcadeGameSessionRepository.listOpen must be implemented'); }
  /** Every device with a persisted current-session record. Startup recovery
   *  must discover push-reporting surfaces as well as configured pollers. */
  async listTrackedDeviceIds() { throw new Error('IArcadeGameSessionRepository.listTrackedDeviceIds must be implemented'); }
  /** Sessions on a device that started at or after an instant — the set that
   *  reconciliation compares against what the device itself recorded. */
  async listForDeviceSince(_deviceId, _sinceIso) { throw new Error('IArcadeGameSessionRepository.listForDeviceSince must be implemented'); }
  /** Every recorded session across all devices in a window — the usage ledger. */
  async listSince(_sinceIso, _untilIso) { throw new Error('IArcadeGameSessionRepository.listSince must be implemented'); }
  /** Whether an on-device recovery artifact was already surfaced. */
  async hasReconciliationEvidence(_deviceId, _evidenceId) {
    throw new Error('IArcadeGameSessionRepository.hasReconciliationEvidence must be implemented');
  }
  /** Durably remember a surfaced recovery artifact so restarts do not re-alarm it. */
  async markReconciliationEvidence(_deviceId, _evidence) {
    throw new Error('IArcadeGameSessionRepository.markReconciliationEvidence must be implemented');
  }
}
