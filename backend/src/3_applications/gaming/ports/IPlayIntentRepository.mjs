/**
 * Stores the standing intent for a device: what we last launched there, for
 * whom, and against which authorisation.
 *
 * One intent per device — a new launch supersedes the last. Reads must tolerate
 * a missing or unreadable record by returning null, because a lost intent must
 * degrade to "we cannot attribute this play" rather than wedge the device.
 */
export class IPlayIntentRepository {
  async record(_intent) { throw new Error('IPlayIntentRepository.record must be implemented'); }
  async findForDevice(_deviceId) { throw new Error('IPlayIntentRepository.findForDevice must be implemented'); }
}
