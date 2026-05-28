/**
 * IPlaybackHubGateway - Port interface for the playback hub.
 *
 * Abstracts the remote playback hub (a Python REST service running on
 * `kckern-playback-hub:8080`). Implementations include the production
 * HttpPlaybackHubAdapter (Phase 3) and the in-memory FakeHubGateway used by
 * use-case tests.
 *
 * Contract:
 *
 * getStatus(): Promise<SlotStatus[]>
 *   Returns one SlotStatus per configured device. May throw InfrastructureError
 *   on network failure / 5xx — the broadcaster catches and backs off.
 *
 * sendCommand(playCommand, targets): Promise<CommandResult>
 *   playCommand: PlayCommand VO (action + optional queue/volume/durationMin).
 *   targets:     HubDevice[] resolved by the SendHubCommand use case.
 *   Returns CommandResult with `applied: string[]` (colors that took effect)
 *   and `skipped: [{color, reason}]`. 409 contention from the hub MUST map to
 *   skipped[{reason:'contention'}] rather than throwing — callers can retry
 *   safely.
 */

/**
 * Abstract base class. Throws on direct method use to surface missing
 * implementations early in tests and adapters.
 */
export class IPlaybackHubGateway {
  /**
   * @returns {Promise<import('../../../2_domains/playback-hub/value-objects/SlotStatus.mjs').SlotStatus[]>}
   */
  async getStatus() {
    throw new Error('IPlaybackHubGateway.getStatus must be implemented');
  }

  /**
   * @param {import('../../../2_domains/playback-hub/value-objects/PlayCommand.mjs').PlayCommand} playCommand
   * @param {import('../../../2_domains/playback-hub/entities/HubDevice.mjs').HubDevice[]} targets
   * @returns {Promise<import('../../../2_domains/playback-hub/value-objects/CommandResult.mjs').CommandResult>}
   */
  async sendCommand(playCommand, targets) {
    throw new Error('IPlaybackHubGateway.sendCommand must be implemented');
  }

  /**
   * Sample the BT sink's PipeWire monitor port and return a peak-meter
   * reading. Lets callers distinguish "playback claimed playing" from
   * "speaker actually receiving samples."
   *
   * @param {string} color
   * @returns {Promise<{
   *   color: string,
   *   sink: string,
   *   peak_dbfs: number|null,
   *   audio_flowing: boolean,
   *   sampled_ms: number,
   *   bt_connected: boolean
   * }>}
   */
  async verifyAudio(color) {
    throw new Error('IPlaybackHubGateway.verifyAudio must be implemented');
  }
}

/**
 * Structural type-check for IPlaybackHubGateway implementers.
 * @param {object} obj
 * @returns {boolean}
 */
export function isPlaybackHubGateway(obj) {
  return Boolean(obj)
    && typeof obj.getStatus === 'function'
    && typeof obj.sendCommand === 'function'
    && typeof obj.verifyAudio === 'function';
}

export default IPlaybackHubGateway;
